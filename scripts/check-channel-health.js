import fs from 'fs/promises';
import axios from 'axios';
import yaml from 'yaml';
import pLimit from 'p-limit';

const CHANNELS_FILE = './data/channels.json';
const STATUS_FILE = './data/lineup_status.json';

let config;
let baseUrl = 'http://localhost:3000';
try {
    config = yaml.parse(await fs.readFile('./config/app.yaml', 'utf8'));
    baseUrl = config.base_url;
} catch (err) {
    console.error(`Failed to load configuration from app.yaml: ${err.message}`);
    process.exit(1);
}

const limit = pLimit(5); // Concurrency limit

function getFullUrl(url) {
    return url.startsWith('http://') || url.startsWith('https://') ? url : baseUrl + url;
}

async function checkStream(url) {
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'IPTV Proxy Health Check',
            },
            timeout: 5000,
            responseType: 'stream',
            maxContentLength: 1024 * 20,
            validateStatus: null,
        });

        const contentType = response.headers['content-type'] || '';
        return response.status === 200 && (
            contentType.startsWith('video/') ||
            contentType.includes('mpegurl') ||
            contentType.includes('octet-stream')
        );
    } catch (err) {
        return false;
    }
}

async function runHealthCheck() {
    const channels = JSON.parse(await fs.readFile(CHANNELS_FILE, 'utf8'));

    const tasks = channels.map(channel => {
        const id = channel.tvg_id;
        const url = getFullUrl(channel.url);

        return limit(async () => {
            const healthy = await checkStream(url);
            return { id, healthy };
        });
    });

    const results = await Promise.all(tasks);
    const statusMap = Object.fromEntries(results.map(r => [r.id, r.healthy ? 'online' : 'offline']));

    await fs.writeFile(STATUS_FILE, JSON.stringify(statusMap, null, 2));
}

runHealthCheck();
