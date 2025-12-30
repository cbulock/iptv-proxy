import fs from 'fs';
import axios from 'axios';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import escapeHtml from 'escape-html';
import { loadConfig } from '../libs/config-loader.js';
import { getChannels } from '../libs/channels-cache.js';

import { getProxiedImageUrl } from '../libs/proxy-image.js';

// Module-level refresher that will be set when routes are initialized
let refreshImpl = null;
export async function refreshEPG() {
    if (typeof refreshImpl === 'function') {
        await refreshImpl();
    } else {
        throw new Error('EPG refresher not initialized');
    }
}

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_"
});
const builder = new XMLBuilder({
    ignoreAttributes: false,
    format: true
});

// Cache for rewritten XML by protocol
let rewrittenXMLCache = new Map();

function rewriteImageUrls(xmlString, req) {
    const protocol = req.get('X-Forwarded-Proto') ||
        req.get('X-Forwarded-Protocol') ||
        req.get('X-Url-Scheme') ||
        (req.get('X-Forwarded-Ssl') === 'on' ? 'https' : req.protocol);
    
    // Check cache
    const cacheKey = `${protocol}://${req.get('host')}`;
    if (rewrittenXMLCache.has(cacheKey)) {
        return rewrittenXMLCache.get(cacheKey);
    }
    
    const parsed = parser.parse(xmlString);

    const rewrite = (node, sourceName) => {
        if (node.icon?.["@_src"]?.startsWith('http')) {
            node.icon["@_src"] = getProxiedImageUrl(node.icon["@_src"], sourceName, req);
        }
    };

    const tv = parsed.tv;
    for (const channel of [].concat(tv.channel || [])) {
        rewrite(channel, channel["display-name"] || "unknown");
    }
    for (const prog of [].concat(tv.programme || [])) {
        rewrite(prog, prog["@_channel"] || "unknown");
    }

    const result = builder.build(parsed);
    
    // Cache the result
    rewrittenXMLCache.set(cacheKey, result);
    
    return result;
}

export async function setupEPGRoutes(app) {
    const epgConfig = loadConfig('epg');
    const epgSources = epgConfig.urls || [];

    let mergedEPG = null;

    async function fetchAndMergeEPGs() {
        const startTime = Date.now();
        const allChannels = getChannels();
        const merged = { tv: { channel: [], programme: [] } };

        for (const source of epgSources) {
            const sourceName = source.name;
            const sourceUrl = source.url;

            const sourceChannels = allChannels.filter(c => c.source === sourceName);
            
            // Build both Sets in a single pass for better performance
            const tvgIds = new Set();
            const names = new Set();
            for (const ch of sourceChannels) {
                if (ch.tvg_id) tvgIds.add(ch.tvg_id);
                names.add(ch.name);
            }

            try {
                console.log(`Loading EPG: ${sourceName} (${sourceUrl})`);

                let xmlData;

                if (sourceUrl.startsWith('file://')) {
                    const path = sourceUrl.replace('file://', '');
                    xmlData = fs.readFileSync(path, 'utf-8');
                } else {
                    const response = await axios.get(sourceUrl, { timeout: 15000 });
                    xmlData = response.data;
                }

                const parsed = parser.parse(xmlData);

                if (parsed.tv?.channel) {
                    const channels = [].concat(parsed.tv.channel).filter(c =>
                        tvgIds.has(c["@_id"]) || names.has(c["display-name"])
                    );

                    merged.tv.channel.push(...channels);
                }

                if (parsed.tv?.programme) {
                    const programmes = [].concat(parsed.tv.programme).filter(p =>
                        tvgIds.has(p["@_channel"]) || names.has(p["@_channel"])
                    );

                    merged.tv.programme.push(...programmes);
                }
                
                console.log(`Loaded ${merged.tv.programme.length} programmes from ${sourceName}`);
            } catch (err) {
                console.warn(`Failed to load EPG from ${sourceName}:`, err.message);
            }
        }

        mergedEPG = builder.build(merged);
        
        // Clear rewritten cache when EPG is refreshed
        rewrittenXMLCache.clear();
        
        const duration = Date.now() - startTime;
        console.log(`EPG merge completed in ${duration}ms (${merged.tv.channel.length} channels, ${merged.tv.programme.length} programmes)`);
    }

    // Expose refresher
    refreshImpl = fetchAndMergeEPGs;

    await fetchAndMergeEPGs();
    setInterval(fetchAndMergeEPGs, 6 * 60 * 60 * 1000);

    app.get('/xmltv.xml', (req, res) => {
        if (!mergedEPG) {
            return res.status(503).send('EPG not loaded yet');
        }

        const rewritten = rewriteImageUrls(mergedEPG, req);

        res.set('Content-Type', 'application/xml');
        res.send(rewritten);
    });

    app.get('/images/:source/:url', async (req, res) => {
        const decodedUrl = decodeURIComponent(req.params.url);
        try {
            const response = await axios.get(decodedUrl, { responseType: 'stream' });
            res.set(response.headers);
            response.data.pipe(res);
        } catch (err) {
            res.status(502).send(`Failed to fetch image from ${escapeHtml(decodedUrl)}`);
        }
    });
}
