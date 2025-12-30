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
    
    // Check cache - include filter params in cache key
    const filterSource = req.query.source || '';
    const filterChannels = req.query.channels || '';
    const cacheKey = `${protocol}://${req.get('host')}|source:${filterSource}|channels:${filterChannels}`;
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
                console.error(`❌ Failed to load EPG from ${sourceName}: ${err.message}`);
                
                // Provide actionable error messages
                if (sourceUrl.startsWith('file://')) {
                    const path = sourceUrl.replace('file://', '');
                    console.log(`   💡 Fix: Local file error`);
                    console.log(`      • Verify the file exists at: ${path}`);
                    console.log(`      • Check file permissions (must be readable)`);
                    console.log(`      • Ensure the path is correct (relative to project root)`);
                } else if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
                    console.log(`   💡 Fix: DNS resolution failed`);
                    console.log(`      • Check the hostname in the URL: ${sourceUrl}`);
                    console.log(`      • Try using an IP address instead`);
                    console.log(`      • Verify DNS server settings`);
                } else if (err.code === 'ECONNREFUSED') {
                    console.log(`   💡 Fix: Connection refused`);
                    console.log(`      • Verify the EPG service is running`);
                    console.log(`      • Check the port number is correct`);
                    console.log(`      • Ensure firewall allows the connection`);
                } else if (err.code === 'ETIMEDOUT') {
                    console.log(`   💡 Fix: Connection timed out`);
                    console.log(`      • The EPG source is taking too long to respond`);
                    console.log(`      • Check network connectivity`);
                    console.log(`      • Try again later if server is overloaded`);
                } else if (err.response?.status === 404) {
                    console.log(`   💡 Fix: EPG file not found (404)`);
                    console.log(`      • Verify the URL is correct: ${sourceUrl}`);
                    console.log(`      • Check that the EPG endpoint exists`);
                } else if (err.response?.status === 401 || err.response?.status === 403) {
                    console.log(`   💡 Fix: Authentication failed (${err.response.status})`);
                    console.log(`      • Check credentials in the URL if required`);
                    console.log(`      • Ensure proper URL encoding of username/password`);
                } else if (err.message?.includes('parse') || err.message?.includes('XML')) {
                    console.log(`   💡 Fix: Invalid XMLTV format`);
                    console.log(`      • Verify the source provides valid XMLTV/XML data`);
                    console.log(`      • Test the URL manually: curl "${sourceUrl}" | head`);
                    console.log(`      • Validate XML at: https://www.xmlvalidation.com/`);
                } else {
                    console.log(`   💡 Fix: Check EPG source accessibility`);
                    console.log(`      • Test manually: curl -I "${sourceUrl}"`);
                    console.log(`      • See README.md troubleshooting section`);
                }
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
            return res.status(503).send('EPG not loaded yet. This usually happens during startup. Please wait a moment and try again. If this persists, check server logs for EPG source errors.');
        }

        // Extract query parameters for filtering
        const filterSource = req.query.source ? String(req.query.source) : null;
        const filterChannels = req.query.channels ? String(req.query.channels).split(',') : null;
        
        let xmlToSend = mergedEPG;
        
        // Apply filters if specified
        if ((filterSource || filterChannels) && typeof mergedEPG === 'string' && mergedEPG.trim()) {
            try {
                const parsed = parser.parse(mergedEPG);
                const allChannels = getChannels();
                
                // Build set of allowed tvg_ids based on filters
                let allowedTvgIds = new Set();
                
                if (filterSource) {
                    // Filter by source
                    const sourceChannels = allChannels.filter(c => c.source === filterSource);
                    sourceChannels.forEach(c => {
                        if (c.tvg_id) allowedTvgIds.add(c.tvg_id);
                    });
                } else if (filterChannels) {
                    // Filter by specific channel IDs
                    filterChannels.forEach(id => allowedTvgIds.add(id.trim()));
                }
                
                // Filter channels and programmes
                if (allowedTvgIds.size > 0 && parsed.tv) {
                    const tv = parsed.tv;
                    tv.channel = [].concat(tv.channel || []).filter(c =>
                        allowedTvgIds.has(c["@_id"])
                    );
                    tv.programme = [].concat(tv.programme || []).filter(p =>
                        allowedTvgIds.has(p["@_channel"])
                    );
                    
                    xmlToSend = builder.build(parsed);
                }
            } catch (err) {
                console.error('[EPG] Error filtering XMLTV:', err.message);
                // Fall back to unfiltered XML
            }
        }

        const rewritten = rewriteImageUrls(xmlToSend, req);

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
