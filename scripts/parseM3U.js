import fs from 'fs';
import axios from 'axios';
import yaml from 'yaml';

const m3uConfig = yaml.parse(fs.readFileSync('./config/m3u.yaml', 'utf8'));
const map = yaml.parse(fs.readFileSync('./config/channel-map.yaml', 'utf8'));

const sources = m3uConfig.urls || [];
const outputPath = './data/channels.json';

function applyMapping(channel) {
    // Try name-based mapping first
    let mapping = map[channel.name];

    // If not found, fall back to tvg_id
    if (!mapping && channel.tvg_id) {
        mapping = map[channel.tvg_id];
    }

    if (mapping) {
        channel.name = mapping.name || channel.name;
        channel.tvg_id = mapping.tvg_id || channel.tvg_id;
        channel.logo = mapping.logo || channel.logo;
        channel.url = mapping.url || channel.url;
        channel.guideNumber = mapping.number || channel.guideNumber;
    }

    // 👇 Fallback: if still no tvg_id, use guideNumber
    if (!channel.tvg_id && channel.guideNumber) {
        channel.tvg_id = channel.guideNumber;
    }

    return channel;
}

function proxyURL(channel) {
    return `/stream/${encodeURIComponent(channel.source)}/${encodeURIComponent(channel.name)}`;
}

export async function parseAll() {
    const allChannels = [];

    for (const source of sources) {
        try {
            console.log(`Processing source: ${source.name}...`);

            if (source.type === 'hdhomerun') {
                if (!source.url) throw new Error(`Missing URL for ${source.name}`);

                const discovery = await axios.get(`${source.url}/discover.json`);
                const deviceInfo = discovery.data;
                const lineupUrl = deviceInfo.LineupURL;

                const lineup = (await axios.get(`${deviceInfo.BaseURL}/lineup.json`)).data;

                for (const chan of lineup) {
                    const channel = {
                        name: chan.GuideName,
                        tvg_id: '',
                        logo: '',
                        url: proxyURL({
                            name: chan.GuideName,
                            source: source.name
                        }),
                        original_url: chan.URL,
                        guideNumber: chan.GuideNumber,
                        source: source.name,
                        hdhomerun: {
                            deviceID: deviceInfo.DeviceID,
                            baseURL: deviceInfo.BaseURL,
                            model: deviceInfo.ModelNumber
                        }
                    };

                    allChannels.push(applyMapping(channel));
                }

                let current = {
                    source: source.name,
                    hdhomerun: {
                        deviceID: deviceInfo.DeviceID,
                        baseURL: deviceInfo.BaseURL,
                        model: deviceInfo.ModelNumber
                    }
                };
            } else {
                // Standard M3U
                const response = await axios.get(source.url);
                const lines = response.data.split('\n');

                let current = {};

                for (const line of lines) {
                    if (line.startsWith('#EXTINF')) {
                        const nameMatch = line.match(/,(.*)$/);
                        const tvgIdMatch = line.match(/tvg-id="(.*?)"/);
                        const tvgLogoMatch = line.match(/tvg-logo="(.*?)"/);

                        current = {
                            name: nameMatch ? nameMatch[1].trim() : 'Unknown',
                            tvg_id: tvgIdMatch ? tvgIdMatch[1] : '',
                            logo: tvgLogoMatch ? tvgLogoMatch[1] : '',
                            source: source.name
                        };
                    } else if (line && !line.startsWith('#')) {
                        current.url = proxyURL(current);
                        current.original_url = line.trim();
                        allChannels.push(applyMapping(current));
                        current = {};
                    }
                }
            }
        } catch (err) {
            console.warn(`Failed to process ${source.name}: ${err.message}`);
        }
    }

    fs.mkdirSync('./data', { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(allChannels, null, 2));
    console.log(`Parsed ${allChannels.length} channels to ${outputPath}`);
}

