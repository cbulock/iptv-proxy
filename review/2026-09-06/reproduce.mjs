// Isolated review probes: no network requests or production configuration writes.
// Run with Node 24: node review/2026-09-06/reproduce.mjs
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import cacheManager from '../../libs/cache-manager.js';
import * as mapping from '../../libs/channel-mapping.js';
import express from 'express';

function load(file, deps, exports) {
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?\n/gm, '')
    .replace(/^export default [\s\S]*?;\s*$/m, '')
    .replace(/^export \{[\s\S]*?\};\s*$/gm, '')
    .replace(/^export /gm, '');
  return new Function(...Object.keys(deps), `${source}\nreturn {${exports.join(',')}};`)(...Object.values(deps));
}
const report = (name, observed) => console.log(JSON.stringify({ name, observed }));
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
const databaseSource = fs.readFileSync('libs/database.js', 'utf8');
for (const match of databaseSource.matchAll(/sql: `([\s\S]*?)`/g)) db.exec(match[1]);
const dbDeps = {
  initDatabase: () => db, getDatabase: () => db,
  transaction: fn => (...args) => { db.exec('BEGIN'); try { const r = fn(...args); db.exec('COMMIT'); return r; } catch(e) { db.exec('ROLLBACK'); throw e; } },
  get: (sql, args = []) => db.prepare(sql).get(...args),
  all: (sql, args = []) => db.prepare(sql).all(...args),
};
const providers = load('libs/source-service.js', {
  ...dbDeps, crypto, fs: {writeFileSync() {}}, yaml: {stringify: JSON.stringify},
  loadConfig: () => ({}), getConfigPath: x => x,
}, ['replaceProvidersConfig', 'loadProvidersConfigFromStore']);
providers.replaceProvidersConfig({providers: [{name: 'A', url: 'http://a.test/list.m3u'}]});
const sourceId = db.prepare('SELECT id FROM sources').get().id;
db.prepare('INSERT INTO source_channels (id, source_id, name, tvg_id, guide_number, stream_url, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run('sc1', sourceId, 'Original', 'a', '1', 'http://a.test/live', new Date().toISOString());
let channelMap = {};
const canonical = load('libs/canonical-channel-service.js', {...dbDeps, crypto, ...mapping, loadChannelMapFromStore: () => channelMap}, ['rebuildCanonicalChannels']);
canonical.rebuildCanonicalChannels();
const oldCanonical = db.prepare('SELECT id FROM canonical_channels').get().id;
db.prepare('UPDATE canonical_channels SET custom_name = ? WHERE id = ?').run('My label', oldCanonical);
channelMap = { Original: {name: 'Renamed', tvg_id: 'a', number: '1'} };
canonical.rebuildCanonicalChannels();
const renamed = db.prepare('SELECT id, custom_name FROM canonical_channels').get();
assert.notEqual(renamed.id, oldCanonical);
assert.equal(renamed.custom_name, null);
report('mapping rename replaces canonical identity', {idChanged: true, customNameLost: true});
providers.replaceProvidersConfig(providers.loadProvidersConfigFromStore());
const remaining = db.prepare('SELECT COUNT(*) AS n FROM source_channels').get().n;
assert.equal(remaining, 0);
report('unchanged provider save deletes discovered rows', {remainingSourceChannels: remaining});
db.close();

const channels = [{name: 'A', source: 'A', tvg_id: 'a'}, {name: 'B', source: 'B', tvg_id: 'b'}];
const profiles = {default: channels, a: [channels[0]], b: [channels[1]], empty: []};
let fail = false;
const routes = {};
class AppError extends Error {}
const epg = load('server/epg.js', {
  fs, fileURLToPath: x => x, axios: {get: async url => {
    if (fail) throw new Error('mock outage');
    const id = url === 'http://a.test/guide' ? 'a' : 'b';
    return {data: `<tv><channel id="${id}"><display-name>${id.toUpperCase()}</display-name></channel><programme channel="${id}" start="20260906120000 +0000"><title>Show ${id}</title></programme></tv>`};
  }}, RateLimit: () => () => {}, XMLParser, XMLBuilder,
  loadAppConfigFromStore: () => ({}), getChannels: () => channels,
  asyncHandler: fn => fn, AppError, validateEPGCoverage: () => ({}), cacheManager,
  requireAuth: () => {}, listSources: () => [{name: 'A', epg: 'http://a.test/guide'}, {name: 'B', epg: 'http://b.test/guide'}],
  getOutputProfile: slug => ({slug, enabled: true}), getOutputProfileChannels: (slug = 'default') => profiles[slug],
  listOutputProfiles: () => Object.keys(profiles).map(slug => ({slug, enabled: true})),
  listGuideBindings: () => [], getProxiedImageUrl: x => x,
  setInterval: () => ({unref() {}}), console: {log() {}, error() {}},
}, ['setupEPGRoutes', 'refreshEPG']);
await epg.setupEPGRoutes({get: (path, ...handlers) => {routes[path] = handlers.at(-1);}});
async function xml(slug, query = {}) {
  let result;
  await routes['/profiles/:slug/xmltv.xml']({params: {slug}, query, protocol: 'http', get: key => key.toLowerCase() === 'host' ? 'proxy.test' : undefined}, {set() {}, send: x => {result = x;}});
  return result;
}
const a = await xml('a');
const b = await xml('b');
assert.equal(a, b);
report('XMLTV profile cache collision', {profileBReceivedProfileA: true});
cacheManager.clearAll();
const empty = await xml('empty');
assert.ok(empty.includes('id="a"') && empty.includes('id="b"'));
report('empty XMLTV profile emits full guide', {channels: ['a', 'b']});
cacheManager.clearAll();
const outside = await xml('a', {channels: 'b'});
assert.ok(outside.includes('id="b"'));
report('channels query escapes XMLTV profile membership', {profile: 'a', emitted: 'b'});
fail = true;
await epg.refreshEPG();
const outage = await xml('a');
assert.ok(!outage.includes('<programme'));
report('failed EPG refresh replaces valid guide with empty guide', {programmes: 0});

let discover;
const hdhr = load('server/hdhr.js', {}, ['setupHDHRRoutes']);
hdhr.setupHDHRRoutes({get: (path, handler) => {if (path === '/discover.json') discover = handler;}}, {host: 'localhost'});
discover({get: () => '192.168.1.5:34400'}, {json: value => report('LAN discovery URL', {BaseURL: value.BaseURL})});

const app = express();
app.set('trust proxy', true);
const req = Object.create(app.request);
req.app = app;
req.socket = {remoteAddress: '203.0.113.12'};
req.headers = {'x-forwarded-for': '127.0.0.1'};
assert.equal(req.ip, '127.0.0.1');
report('untrusted forwarded IP accepted', {socket: req.socket.remoteAddress, reqIp: req.ip});

const lineupRoutes = {};
let output = [{name: 'Renamed', streamName: 'Original', source: 'A', tvg_id: 'a', guideNumber: '1'}];
const mappedChannels = [{name: 'Renamed', source: 'A', tvg_id: 'a', guideNumber: '1', original_url: 'http://a.test/live'}];
const lineup = load('server/lineup.js', {
  axios: {}, RateLimit: () => () => {}, getProxiedImageUrl: x => x,
  getBaseUrl: () => 'http://proxy.test', loadAppConfigFromStore: () => ({}),
  getChannels: () => mappedChannels, asyncHandler: fn => fn, AppError, cacheManager,
  loadChannelMapFromStore: () => ({Original: {name: 'Renamed', tvg_id: 'a', number: '1'}}),
  getOutputProfile: () => ({enabled: true}), getOutputProfileChannels: () => output,
  console: {log() {}, info() {}, warn() {}},
}, ['setupLineupRoutes', 'invalidateLineupCaches: invalidateCaches']);
lineup.setupLineupRoutes({get: (path, ...handlers) => {lineupRoutes[path] = handlers.at(-1);}, all: (path, handler) => {lineupRoutes[path] = handler;}}, {});
let listed;
const lineupReq = {params: {}, query: {}, protocol: 'http', path: '/lineup.json', get: () => 'proxy.test'};
await lineupRoutes['/lineup.json'](lineupReq, {json: x => {listed = x;}});
assert.ok(listed[0].URL.endsWith('/A/Original'));
let streamStatus;
await lineupRoutes['/stream/:source/:name']({params: {source: 'A', name: 'Original'}, query: {}, method: 'GET'}, {status: code => {streamStatus = code; return {send() {}};}});
assert.equal(streamStatus, 404);
report('mapped-name lineup URL does not resolve', {url: listed[0].URL, streamStatus});
output = [];
lineup.invalidateLineupCaches();
await lineupRoutes['/lineup.json'](lineupReq, {json: x => {listed = x;}});
assert.equal(listed.length, 1);
report('empty default output falls back to mapped channels', {emittedChannels: listed.length});
