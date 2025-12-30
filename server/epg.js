import fs from 'fs';
import axios from 'axios';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import escapeHtml from 'escape-html';
import { loadConfig } from '../libs/config-loader.js';
import { getChannels } from '../libs/channels-cache.js';
import { asyncHandler, AppError } from './error-handler.js';

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
                    try {
                        xmlData = fs.readFileSync(path, 'utf-8');
                    } catch (fileErr) {
                        throw new Error(`Failed to read file: ${fileErr.message}`);
                    }
                } else {
                    try {
                        const response = await axios.get(sourceUrl, { 
                            timeout: 15000,
                            validateStatus: (status) => status === 200
                        });
                        xmlData = response.data;
                    } catch (httpErr) {
                        throw new Error(`Failed to fetch EPG: ${httpErr.message}`);
                    }
                }

                // Validate that we got XML data
                if (!xmlData || typeof xmlData !== 'string' || xmlData.trim().length === 0) {
                    throw new Error('Empty or invalid EPG data received');
                }

                // Validate basic XML structure
                if (!xmlData.trim().startsWith('<?xml') && !xmlData.trim().startsWith('<tv')) {
                    throw new Error('Invalid XML format - missing XML declaration or root element');
                }

                let parsed;
                try {
                    parsed = parser.parse(xmlData);
                } catch (parseErr) {
                    throw new Error(`XML parsing failed: ${parseErr.message}`);
                }

                // Validate parsed structure
                if (!parsed || !parsed.tv) {
                    throw new Error('Invalid XMLTV structure - missing <tv> root element');
                }

                if (parsed.tv?.channel) {
                    const channels = [].concat(parsed.tv.channel).filter(c =>
                        c && (tvgIds.has(c["@_id"]) || names.has(c["display-name"]))
                    );

                    merged.tv.channel.push(...channels);
                }

                if (parsed.tv?.programme) {
                    const programmes = [].concat(parsed.tv.programme).filter(p =>
                        p && (tvgIds.has(p["@_channel"]) || names.has(p["@_channel"]))
                    );

                    merged.tv.programme.push(...programmes);
                }
                
                console.log(`Loaded ${merged.tv.programme.length} programmes from ${sourceName}`);
            } catch (err) {
                console.warn(`Failed to load EPG from ${sourceName}:`, err.message);
            }
        }

        try {
            mergedEPG = builder.build(merged);
        } catch (buildErr) {
            console.error('Failed to build merged EPG XML:', buildErr.message);
            // Keep the old EPG if build fails
            if (!mergedEPG) {
                mergedEPG = '<?xml version="1.0" encoding="UTF-8"?>\n<tv></tv>';
            }
        }
        
        // Clear rewritten cache when EPG is refreshed
        rewrittenXMLCache.clear();
        
        const duration = Date.now() - startTime;
        console.log(`EPG merge completed in ${duration}ms (${merged.tv.channel.length} channels, ${merged.tv.programme.length} programmes)`);
    }

    // Expose refresher
    refreshImpl = fetchAndMergeEPGs;

    await fetchAndMergeEPGs();
    setInterval(fetchAndMergeEPGs, 6 * 60 * 60 * 1000);

    app.get('/xmltv.xml', asyncHandler(async (req, res) => {
        try {
            if (!mergedEPG) {
                throw new AppError('EPG not loaded yet', 503);
            }

            // Extract query parameters for filtering
            const filterSource = req.query.source ? String(req.query.source) : null;
            const filterChannels = req.query.channels ? String(req.query.channels).split(',') : null;
            
            let xmlToSend = mergedEPG;
            
            // Apply filters if specified
            if ((filterSource || filterChannels) && typeof mergedEPG === 'string' && mergedEPG.trim()) {
                try {
                    const parsed = parser.parse(mergedEPG);
                    
                    if (!parsed || !parsed.tv) {
                        throw new Error('Invalid EPG structure');
                    }
                    
                    const allChannels = getChannels();
                    
                    // Build set of allowed tvg_ids based on filters
                    let allowedTvgIds = new Set();
                    
                    if (filterSource) {
                        // Filter by source
                        const sourceChannels = allChannels.filter(c => c && c.source === filterSource);
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
                            c && allowedTvgIds.has(c["@_id"])
                        );
                        tv.programme = [].concat(tv.programme || []).filter(p =>
                            p && allowedTvgIds.has(p["@_channel"])
                        );
                        
                        xmlToSend = builder.build(parsed);
                    }
                } catch (filterErr) {
                    console.error('[EPG] Error filtering XMLTV:', filterErr.message);
                    // Fall back to unfiltered XML
                }
            }

            const rewritten = rewriteImageUrls(xmlToSend, req);

            res.set('Content-Type', 'application/xml');
            res.send(rewritten);
        } catch (err) {
            if (err.statusCode === 503) {
                throw err;
            }
            console.error('[xmltv.xml] Error generating EPG:', err.message);
            throw new AppError('Failed to generate XMLTV EPG', 500, err.message);
        }
    }));

    app.get('/images/:source/:url', asyncHandler(async (req, res) => {
        const decodedUrl = decodeURIComponent(req.params.url);
        
        // Validate URL format
        if (!decodedUrl.startsWith('http://') && !decodedUrl.startsWith('https://')) {
            throw new AppError('Invalid image URL', 400, 'URL must start with http:// or https://');
        }
        
        try {
            const response = await axios.get(decodedUrl, { 
                responseType: 'stream',
                timeout: 10000,
                maxRedirects: 5
            });
            res.set(response.headers);
            response.data.pipe(res);
        } catch (err) {
            const statusCode = err.response?.status || 502;
            throw new AppError(
                `Failed to fetch image`,
                statusCode,
                `Could not retrieve image from ${escapeHtml(decodedUrl)}`
            );
        }
    }));
}
