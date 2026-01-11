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
        channel.group = mapping.group || channel.group;
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
            if (!source.url) {
                const errorMsg = `Missing URL for HDHomeRun source "${source.name}"`;
                console.error(`❌ ${errorMsg}`);
                console.log(`   💡 Fix: Add a "url" field in m3u.yaml for this source`);
                console.log(`      Example: url: "http://192.168.1.100" or url: "http://hdhomerun.local"`);
                throw new Error(errorMsg);
            }

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
            let response;
            try {
                response = await axios.get(source.url, {
                    timeout: 30000,
                    maxContentLength: 50 * 1024 * 1024, // 50MB max
                    validateStatus: (status) => status === 200
                });
            } catch (fetchErr) {
                throw new Error(`Failed to fetch M3U: ${fetchErr.message}`);
            }

            if (!response.data || typeof response.data !== 'string') {
                throw new Error('Invalid M3U data: expected text content');
            }

            let data;
            if (source.url.startsWith('file://')) {
                const filePath = source.url.replace('file://', '');
                data = fs.readFileSync(filePath, 'utf8');
            } else {
                const response = await axios.get(source.url);
                data = response.data;
            }
            const lines = data.split('\n');

            // Validate M3U header and check if file is empty
            if (lines.length === 0) {
                throw new Error('Empty M3U file');
            }
            
            if (!lines[0].trim().startsWith('#EXTM3U')) {
                console.warn(`Warning: ${source.name} missing #EXTM3U header`);
            }

            // Valid streaming protocols
            const validProtocols = ['http://', 'https://', 'rtsp://', 'rtp://', 'udp://'];
            let current = {};
            let lineNumber = 0;

            for (const line of lines) {
                lineNumber++;
                const trimmedLine = line.trim();
                
                if (!trimmedLine) continue; // Skip empty lines
                
                if (trimmedLine.startsWith('#EXTINF')) {
                    try {
                        const nameMatch = trimmedLine.match(/,(.*)$/);
                        const tvgIdMatch = trimmedLine.match(/tvg-id="(.*?)"/);
                        const tvgLogoMatch = trimmedLine.match(/tvg-logo="(.*?)"/);

                        current = {
                            name: nameMatch ? nameMatch[1].trim() : 'Unknown',
                            tvg_id: tvgIdMatch ? tvgIdMatch[1] : '',
                            logo: tvgLogoMatch ? tvgLogoMatch[1] : '',
                            source: source.name
                        };
                    } catch (lineErr) {
                        console.warn(`[${source.name}:${lineNumber}] Malformed EXTINF: ${lineErr.message}`);
                        current = {};
                    }
                } else if (trimmedLine && !trimmedLine.startsWith('#')) {
                    // Validate URL format using valid protocols array
                    const hasValidProtocol = validProtocols.some(protocol => trimmedLine.startsWith(protocol));
                    
                    if (!hasValidProtocol) {
                        console.warn(`[${source.name}:${lineNumber}] Invalid stream URL format: ${trimmedLine.substring(0, 50)}`);
                        current = {};
                        continue;
                    }

                    if (current.name) {
                        current.url = proxyURL(current);
                        current.original_url = trimmedLine;
                        channels.push(applyMapping(current, map));
                    }
                    current = {};
                }
            }
        }
        
        console.log(`Processed ${channels.length} channels from ${source.name}`);
        if (statusCallback) statusCallback(source.name, 'success');
    } catch (err) {
        console.error(`❌ Failed to process ${source.name}: ${err.message}`);
        
        // Provide actionable error messages based on error type
        if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
            console.log(`   💡 Fix: DNS resolution failed - check the hostname/URL`);
            console.log(`      • Verify the domain name is correct`);
            console.log(`      • Try using an IP address instead: ${source.url}`);
            console.log(`      • Check your DNS server settings`);
        } else if (err.code === 'ECONNREFUSED') {
            console.log(`   💡 Fix: Connection refused - the server is not responding`);
            console.log(`      • Verify the service is running on the target host`);
            console.log(`      • Check the port number is correct`);
            console.log(`      • Ensure firewall rules allow the connection`);
        } else if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
            console.log(`   💡 Fix: Connection timed out`);
            console.log(`      • Check network connectivity to ${source.url}`);
            console.log(`      • Verify the server is online and responsive`);
            console.log(`      • Consider increasing timeout settings if server is slow`);
        } else if (err.response?.status === 401 || err.response?.status === 403) {
            console.log(`   💡 Fix: Authentication failed (${err.response.status})`);
            console.log(`      • Check username and password are correct`);
            console.log(`      • Ensure credentials are URL-encoded in the URL`);
            console.log(`      • Example: https://user:pass@example.com/playlist.m3u`);
        } else if (err.response?.status === 404) {
            console.log(`   💡 Fix: Resource not found (404)`);
            console.log(`      • Verify the URL path is correct: ${source.url}`);
            console.log(`      • Check the M3U file exists at this location`);
        } else if (err.response?.status >= 500) {
            console.log(`   💡 Fix: Server error (${err.response.status})`);
            console.log(`      • The source server is experiencing issues`);
            console.log(`      • Try again later or contact the service provider`);
        } else if (source.type === 'hdhomerun') {
            console.log(`   💡 Fix: HDHomeRun device error`);
            console.log(`      • Verify device is powered on and connected to network`);
            console.log(`      • Test access: curl ${source.url}/discover.json`);
            console.log(`      • Check device IP address hasn't changed`);
        } else {
            console.log(`   💡 Fix: Check the source URL and network connectivity`);
            console.log(`      • Test manually: curl -I "${source.url}"`);
            console.log(`      • See troubleshooting guide in README.md`);
        }
        
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


