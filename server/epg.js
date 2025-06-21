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
        res.set('Content-Type', 'application/xml');
        res.send(mergedEPG);
    });
}