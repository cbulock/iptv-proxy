import fs from 'fs';
import axios from 'axios';
import yaml from 'yaml';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_"
});
const builder = new XMLBuilder({
    ignoreAttributes: false,
    format: true
});

function rewriteImageUrls(xmlString, baseUrl) {
    const parsed = parser.parse(xmlString);

    const rewrite = (node, sourceName) => {
        if (node.icon?.["@_src"]?.startsWith('http')) {
            const encodedUrl = encodeURIComponent(node.icon["@_src"]);
            node.icon["@_src"] = `${baseUrl}/images/${encodeURIComponent(sourceName)}/${encodedUrl}`;
        }
    };

    const tv = parsed.tv;
    for (const channel of [].concat(tv.channel || [])) {
        rewrite(channel, channel["display-name"] || "unknown");
    }
    for (const prog of [].concat(tv.programme || [])) {
        rewrite(prog, prog["@_channel"] || "unknown");
    }

    return builder.build(parsed);
}

export async function setupEPGRoutes(app) {
    const epgConfig = yaml.parse(fs.readFileSync('./config/epg.yaml', 'utf8'));
    const epgSources = epgConfig.urls || [];

    const allChannels = JSON.parse(fs.readFileSync('./data/channels.json', 'utf8'));

    let mergedEPG = null;

    async function fetchAndMergeEPGs() {
        const merged = { tv: { channel: [], programme: [] } };

        for (const source of epgSources) {
            const sourceName = source.name;
            const sourceUrl = source.url;

            const sourceChannels = allChannels.filter(c => c.source === sourceName);
            const tvgIds = new Set(sourceChannels.map(c => c.tvg_id).filter(Boolean));
            const names = new Set(sourceChannels.map(c => c.name));

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
            } catch (err) {
                console.warn(`Failed to load EPG from ${sourceName}:`, err.message);
            }
        }

        mergedEPG = builder.build(merged);
    }

    await fetchAndMergeEPGs();
    setInterval(fetchAndMergeEPGs, 6 * 60 * 60 * 1000);

    app.get('/xmltv.xml', (req, res) => {
        if (!mergedEPG) {
            return res.status(503).send('EPG not loaded yet');
        }

        // Check for proxy headers to determine the correct protocol
        const protocol = req.get('X-Forwarded-Proto') ||
            req.get('X-Forwarded-Protocol') ||
            req.get('X-Url-Scheme') ||
            (req.get('X-Forwarded-Ssl') === 'on' ? 'https' : req.protocol);

        const publicBaseUrl = `${protocol}://${req.get('host')}`;
        const rewritten = rewriteImageUrls(mergedEPG, publicBaseUrl);

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
            res.status(502).send(`Failed to fetch image from ${decodedUrl}`);
        }
    });
}
