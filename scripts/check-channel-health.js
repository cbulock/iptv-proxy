import fs from 'fs/promises';
import axios from 'axios';
import { loadConfig } from '../libs/config-loader.js';
import pLimit from 'p-limit';

const CHANNELS_FILE = './data/channels.json';
const STATUS_FILE = './data/lineup_status.json';
const LAST_LOG_FILE = './data/lineup_health_last.json';

let config;
let baseUrl = 'http://localhost:3000';
async function loadBaseUrl() {
    try {
        config = loadConfig('app');
        if (config && config.base_url) baseUrl = config.base_url;
    } catch (err) {
        // fallback to default, do not exit
        console.warn('Health check: using default base URL (config missing).');
    }
}

const limit = pLimit(5); // Concurrency limit

function getFullUrl(url) {
    return url.startsWith('http://') || url.startsWith('https://') ? url : baseUrl + url;
}

function isHealthyStatus(statusCode, contentType) {
    if (![200, 206].includes(statusCode)) return false;
    const ct = (contentType || '').toLowerCase();
    return ct.startsWith('video/') ||
        ct.includes('mpegurl') ||
        ct.includes('octet-stream') ||
        ct.includes('transportstream') ||
        ct.includes('mp2t') ||
        ct.includes('mpeg');
}

async function checkStream(url) {
    const started = Date.now();
    // First try HEAD (faster) then GET if needed
    try {
        const headResp = await axios.head(url, {
            headers: { 'User-Agent': 'IPTV Proxy Health Check' },
            timeout: 8000,
            maxContentLength: 1024 * 8,
            validateStatus: null,
        });
        const headCT = headResp.headers['content-type'] || '';
        const headHealthy = isHealthyStatus(headResp.status, headCT);
        if (headHealthy) {
            return { healthy: true, statusCode: headResp.status, contentType: headCT, ms: Date.now() - started, error: '', method: 'HEAD' };
        }
    } catch (e) {
        // ignore head failure; proceed to GET
    }
    try {
        const getResp = await axios.get(url, {
            headers: { 'User-Agent': 'IPTV Proxy Health Check' },
            timeout: 12000,
            responseType: 'stream',
            maxContentLength: 1024 * 128,
            validateStatus: null,
        });
        const ms = Date.now() - started;
        const statusCode = getResp.status;
        const contentType = getResp.headers['content-type'] || '';
            // Wait for first byte up to 4s or until 1KB read
            const stream = getResp.data;
            let bytesRead = 0;
            let ttfb = null;
            await new Promise((resolve) => {
                let done = false;
                const onData = (chunk) => {
                    if (ttfb === null) ttfb = Date.now() - started;
                    bytesRead += (chunk && chunk.length) ? chunk.length : 0;
                    if (!done && bytesRead >= 1024) { done = true; cleanup(); resolve(); }
                };
                const onEnd = () => { if (!done) { done = true; cleanup(); resolve(); } };
                const onError = () => { if (!done) { done = true; cleanup(); resolve(); } };
                const timer = setTimeout(() => { if (!done) { done = true; cleanup(); resolve(); } }, 4000);
                function cleanup() { clearTimeout(timer); stream.off('data', onData); stream.off('end', onEnd); stream.off('error', onError); }
                stream.on('data', onData);
                stream.on('end', onEnd);
                stream.on('error', onError);
            });
            const healthy = isHealthyStatus(statusCode, contentType) || bytesRead > 0;
            return { healthy, statusCode, contentType, ms, ttfb, bytesRead, error: healthy ? '' : 'unhealthy content-type or no data', method: 'GET' };
    } catch (err) {
            return { healthy: false, statusCode: err.response?.status || 0, contentType: '', ms: Date.now() - started, ttfb: null, bytesRead: 0, error: err.message || 'request failed', method: 'GET-ERR' };
    }
}

export async function runHealthCheck() {
    await loadBaseUrl();
    const channels = JSON.parse(await fs.readFile(CHANNELS_FILE, 'utf8'));

            const runStarted = Date.now();
            const tasks = channels.map(channel => limit(async () => {
            const id = channel.tvg_id || channel.guideNumber || channel.name;
            const proxiedUrl = getFullUrl(channel.url);
            const directUrl = channel.original_url || '';
            let result = await checkStream(directUrl || proxiedUrl);
            let pathTried = directUrl ? 'direct' : 'proxied';
            if (!result.healthy && directUrl) {
                const second = await checkStream(proxiedUrl);
                if (second.healthy) { result = second; pathTried = 'proxied'; }
                else pathTried += '->proxied';
            }
                const urlUsed = pathTried.startsWith('direct') && directUrl ? directUrl : proxiedUrl;
                return { id, healthy: result.healthy, statusCode: result.statusCode, ms: result.ms, ttfb: result.ttfb, bytesRead: result.bytesRead, contentType: result.contentType, error: result.error, method: result.method, path: pathTried, url: urlUsed };
        }));

        const detailed = await Promise.all(tasks);
    const statusMap = Object.fromEntries(detailed.map(r => [r.id, r.healthy ? 'online' : 'offline']));
            const meta = {
                startedAt: new Date(runStarted).toISOString(),
                endedAt: new Date().toISOString(),
                durationMs: Date.now() - runStarted,
                totals: { online: detailed.filter(d => d.healthy).length, offline: detailed.filter(d => !d.healthy).length, total: detailed.length }
            };
            await fs.writeFile(STATUS_FILE, JSON.stringify({ summary: statusMap, details: detailed }, null, 2));
            await fs.writeFile(LAST_LOG_FILE, JSON.stringify({ meta, details: detailed }, null, 2));
    return statusMap;
}
