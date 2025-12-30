import fs from 'fs';
import axios from 'axios';
import pLimit from 'p-limit';
import { loadConfig } from '../libs/config-loader.js';
import { getDataPath, DATA_DIR } from '../libs/paths.js';

const outputPath = getDataPath('channels.json');

// Limit concurrent source fetches
const limit = pLimit(3);

// Status callback (optional, set by server)
let statusCallback = null;
export function setStatusCallback(callback) {
    statusCallback = callback;
}

function applyMapping(channel, map) {
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

/**
 * Process a single M3U source
 * @param {Object} source - Source configuration
 * @param {Object} map - Channel mapping
 * @returns {Promise<Array>} Array of channels
 */
async function processSource(source, map) {
    const channels = [];
    
    try {
        console.log(`Processing source: ${source.name}...`);
        if (statusCallback) statusCallback(source.name, 'pending');

        if (source.type === 'hdhomerun') {
            if (!source.url) throw new Error(`Missing URL for ${source.name}`);

            const discovery = await axios.get(`${source.url}/discover.json`);
            const deviceInfo = discovery.data;

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

                channels.push(applyMapping(channel, map));
            }
        } else {
            // Standard M3U - stream processing for large files
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
                    channels.push(applyMapping(current, map));
                    current = {};
                }
            }
        }
        
        console.log(`Processed ${channels.length} channels from ${source.name}`);
        if (statusCallback) statusCallback(source.name, 'success');
    } catch (err) {
        console.warn(`Failed to process ${source.name}: ${err.message}`);
        if (statusCallback) statusCallback(source.name, 'error', err.message);
    }
    
    return channels;
}

export async function parseAll() {
    const startTime = Date.now();
    
    // Load config dynamically so updates take effect without restart
    const m3uConfig = loadConfig('m3u');
    const sources = m3uConfig.urls || [];
    const map = loadConfig('channelMap');

    // Process sources in parallel with concurrency limit
    const channelArrays = await Promise.all(
        sources.map(source => limit(() => processSource(source, map)))
    );
    
    // Flatten the array of arrays
    const allChannels = channelArrays.flat();

    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(allChannels, null, 2));
    
    const duration = Date.now() - startTime;
    console.log(`Parsed ${allChannels.length} channels to ${outputPath} in ${duration}ms`);

    return allChannels.length;
}


