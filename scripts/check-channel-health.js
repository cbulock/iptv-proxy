import fs from 'fs/promises';
import axios from 'axios';
import yaml from 'yaml';

const appConfig = yaml.parse(await fs.readFile('./config/app.yaml', 'utf8'));
const BASE_URL = appConfig.base_url;

const CHANNELS_FILE = './data/channels.json';
const STATUS_FILE = './data/lineup_status.json';

function getFullUrl(url) {
    return url.startsWith('http://') || url.startsWith('https://')
        ? url
        : BASE_URL + url;
}

async function checkStream(url) {
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'iptv-proxy health-check/1.0',
            },
            timeout: 5000,
            responseType: 'stream',
            maxContentLength: 1024 * 20,
            validateStatus: null,
        });

        console.log(`Checked ${url} -> status ${response.status}, content-type ${response.headers['content-type']}`);


        if (
            response.status === 200 &&
            response.headers['content-type'] &&
            (response.headers['content-type'].startsWith('video/') ||
                response.headers['content-type'].includes('mpegurl') ||
                response.headers['content-type'].includes('octet-stream'))
        ) {
            return true;
        }
    } catch (err) {
        console.warn(`Error checking ${url}: ${err.message}`);
    }

    return false;
}

async function runHealthCheck() {
    const channels = JSON.parse(await fs.readFile(CHANNELS_FILE, 'utf8'));
    const statusMap = {};

    for (const channel of channels) {
        const healthy = await checkStream(getFullUrl(channel.url));
        if (channel.tvg_id) {
            statusMap[channel.tvg_id] = healthy ? 'online' : 'offline';
        }
        else {
            console.warn(`Channel missing tvg_id: ${channel.name}`);
        }
    }

    await fs.writeFile(STATUS_FILE, JSON.stringify(statusMap, null, 2));
}

runHealthCheck();
