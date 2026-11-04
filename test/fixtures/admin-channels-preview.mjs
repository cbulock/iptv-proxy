// Local-only manual UX harness. No real providers, database, or production requests.
// Run: node test/fixtures/admin-channels-preview.mjs
import { createServer } from '../../admin/node_modules/vite/dist/node/index.js';
import vue from '../../admin/node_modules/@vitejs/plugin-vue/dist/index.mjs';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';

let empty = false;
let failSave = false;
let failRead = false;
let failReadAfterSave = false;
const auditFlags = {
  failChannelReload: false, failGuideReload: false, failPreview: false, failGuide: false,
  channelReloadDelayMs: 0, guideReloadDelayMs: 0,
};
let providers = [{ name: 'Antenna', type: 'm3u', url: 'http://fixture.invalid/lineup.m3u', epg: 'http://fixture.invalid/guide.xml' }];
const isoAgo = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const xmltvTime = milliseconds => new Date(milliseconds).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
const backups = [{ name: 'backup-2026-11-04T09-30-00-123456' }, { name: 'backup-2026-11-03T09-30-00-123456' }];
const jobs = [
  { name: 'refresh-channels', schedule: '0 */6 * * *', isRunning: false, lastStatus: 'success', lastRun: isoAgo(20), lastDuration: 1240 },
  { name: 'refresh-epg', schedule: '0 */4 * * *', isRunning: false, lastStatus: 'Synthetic guide timeout', lastRun: isoAgo(45), lastDuration: 5000 },
];
const health = {
  status: 'ok', summary: { metv: 'online', wlns: 'offline' },
  details: [
    { id: 'metv', name: 'MeTV', healthy: true, ms: 82, statusCode: 200, contentType: 'video/mp2t', error: '', method: 'GET', path: '/stream/channel/metv-antenna' },
    { id: 'wlns', name: 'WLNS-TV', healthy: false, ms: 5000, statusCode: 503, contentType: '', error: 'Synthetic upstream timeout', method: 'GET', path: '/stream/channel/wlns-antenna' },
  ], meta: { startedAt: isoAgo(2), endedAt: isoAgo(1) },
};
const active = [{ ip: '192.0.2.10', channelId: 'metv', name: 'MeTV', tvg_id: '10.2', userName: 'Demo viewer', userId: 'fixture-viewer', client: 'VLC', userAgent: 'Synthetic local audit session', startedAt: isoAgo(12), lastSeenAt: isoAgo(0) }];
const history = [{ id: 'fixture-session-1', ip: '192.0.2.11', channelId: 'wlns', name: 'WLNS-TV', userName: 'Demo viewer', client: 'Browser', startedAt: isoAgo(40), endedAt: isoAgo(25), durationSeconds: 900 }];
const channels = [
  { id: 'metv', name: 'MeTV', baseName: 'MeTV', guideNumber: '11', tvg_id: '10.2' },
  { id: 'wlns', name: 'WLNS-TV', baseName: 'WLNS-TV', guideNumber: '6', tvg_id: '6.1' },
  { id: 'great', name: 'GREAT', baseName: 'GREAT', guideNumber: null, tvg_id: null },
  ...Array.from({ length: 26 }, (_, i) => ({ id: `sample-${i}`, name: `Sample channel ${i + 1}`, baseName: `Sample channel ${i + 1}`, guideNumber: String(i + 30), tvg_id: `sample.${i}` })),
];
const bindings = channels.map(channel => ({ canonical: { id: channel.id }, sourceChannel: { id: `${channel.id}-antenna`, source: 'Antenna', name: channel.name, sourceGuideNumber: channel.tvg_id || '49.11' }, isPreferredStream: channel.id !== 'great' }));
bindings.push({ canonical: { id: 'metv' }, sourceChannel: { id: 'metv-cable', source: 'Cable', name: 'MeTV', sourceGuideNumber: '42' }, isPreferredStream: false });
const guides = channels.filter(channel => !channel.id.startsWith('sample')).map(channel => ({ canonical: { id: channel.id }, source: { id: 'antenna', name: 'Antenna' }, epgChannelId: channel.tvg_id || channel.id, selected: channel.id !== 'great' }));
const profiles = [{ slug: 'default', name: 'Default Output', enabled: true, isDefault: true }, { slug: 'family', name: 'Family', enabled: true, isDefault: false }];
const entries = Object.fromEntries(profiles.map(profile => [profile.slug, channels.map((channel, i) => ({ canonical: channel, enabled: profile.slug === 'family' ? channel.id === 'metv' : channel.id !== 'great', position: i, guideNumberOverride: null }))]));
const requests = [];

const server = await createServer({
  root: fileURLToPath(new URL('../../admin', import.meta.url)), configFile: false,
  base: '/admin/', plugins: [vue(), { name: 'isolated-channel-fixtures', configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/stream/') && !url.pathname.startsWith('/transcode/') && url.pathname !== '/__fixture') return next();
      res.setHeader('Content-Type', 'application/json');
      const send = (value, status = 200) => { res.statusCode = status; res.end(JSON.stringify(value)); };
      if (url.pathname === '/__fixture') {
        if (url.searchParams.has('empty')) empty = url.searchParams.get('empty') === 'true';
        if (url.searchParams.has('failSave')) failSave = url.searchParams.get('failSave') === 'true';
        if (url.searchParams.has('failRead')) failRead = url.searchParams.get('failRead') === 'true';
        if (url.searchParams.has('failReadAfterSave')) failReadAfterSave = url.searchParams.get('failReadAfterSave') === 'true';
        for (const key of Object.keys(auditFlags)) {
          if (url.searchParams.has(key)) auditFlags[key] = key.endsWith('DelayMs')
            ? Math.min(15000, Math.max(0, Number(url.searchParams.get(key)) || 0))
            : url.searchParams.get(key) === 'true';
        }
        return send({ empty, failSave, failRead, failReadAfterSave, ...auditFlags, requests });
      }
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = body ? JSON.parse(body) : {};
      requests.push({ method: req.method, path: url.pathname, body: data });
      if (url.pathname === '/api/auth/status') return send({ configured: true });
      if (url.pathname === '/api/auth/session') return send({ authenticated: true });
      if (url.pathname === '/api/auth/csrf-token') return send({ csrfToken: 'local-fixture' });
      if (url.pathname === '/api/config/app') return send({ base_url: 'http://127.0.0.1:5178', oauth: {} });
      if (url.pathname.startsWith('/stream/') || url.pathname.startsWith('/transcode/') || url.pathname.startsWith('/api/stream-probe/')) return send({ error: 'Synthetic stream unavailable (isolated UX fixture)' }, 503);
      if (url.pathname === '/api/config/providers') {
        if (req.method === 'PUT') providers = structuredClone(data.providers || []);
        return send({ providers, status: 'ok' });
      }
      if (url.pathname === '/api/config/backups') return send({ backups: empty ? [] : backups, count: empty ? 0 : backups.length });
      if (url.pathname === '/api/config/backup') {
        const name = `backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-123456`;
        backups.unshift({ name });
        return send({ status: 'created', name, files: ['synthetic-config.json'] });
      }
      const backupMatch = url.pathname.match(/^\/api\/config\/backups\/([^/]+)(?:\/(restore|download))?$/);
      if (backupMatch) {
        const name = decodeURIComponent(backupMatch[1]);
        const index = backups.findIndex(item => item.name === name);
        if (index < 0) return send({ error: 'Backup not found' }, 404);
        if (req.method === 'DELETE') { backups.splice(index, 1); return send({ status: 'deleted', name }); }
        if (backupMatch[2] === 'restore') return send({ status: 'restored', name, files: ['synthetic-config.json'] });
        if (backupMatch[2] === 'download') {
          res.setHeader('Content-Type', 'application/zip');
          res.setHeader('Content-Disposition', `attachment; filename="${name}.zip"`);
          const archive = archiver('zip');
          archive.on('error', error => res.destroy(error));
          archive.pipe(res);
          archive.append(JSON.stringify({ synthetic: true, providers }, null, 2), { name: 'synthetic-config.json' });
          await archive.finalize();
          return;
        }
      }
      if (url.pathname === '/api/usage/active') return send({ active: empty ? [] : active, count: empty ? 0 : active.length });
      if (url.pathname === '/api/usage/history') return send({ history: empty ? [] : history, count: empty ? 0 : history.length });
      if (url.pathname === '/api/channel-health' || url.pathname === '/api/channel-health/run') return send(empty ? { details: [], summary: {} } : health);
      if (url.pathname === '/api/scheduler/jobs') return send({ jobs: empty ? [] : jobs });
      const taskMatch = url.pathname.match(/^\/api\/scheduler\/jobs\/([^/]+)\/run$/);
      if (taskMatch) {
        const job = jobs.find(item => item.name === decodeURIComponent(taskMatch[1]));
        if (!job) return send({ error: 'Job not found' }, 404);
        Object.assign(job, { isRunning: true, lastRun: isoAgo(0) });
        setTimeout(() => Object.assign(job, { isRunning: false, lastStatus: 'success', lastDuration: 1200 }), 1200);
        return send({ status: 'started', message: `Job "${job.name}" started`, job });
      }
      if (url.pathname === '/api/guide') {
        if (auditFlags.failGuide) return send({ error: 'Synthetic guide lookup failed' }, 503);
        const programmes = empty ? [] : ['Local favourites', 'Evening news', 'Family classics'].map((title, i) => ({
          title, desc: 'Synthetic programme for isolated interface testing.', channel: url.searchParams.get('tvgId') || '10.2',
          start: xmltvTime(Date.now() + (i * 30 - 10) * 60000), stop: xmltvTime(Date.now() + (i * 30 + 20) * 60000),
        }));
        return send({ programmes, total: programmes.length });
      }
      if (url.pathname === '/api/canonical/channels') return failRead ? send({ error: 'Fixture read failed' }, 503) : send({ channels: empty ? [] : channels });
      if (url.pathname === '/api/canonical/bindings') return send({ bindings: empty ? [] : bindings });
      if (url.pathname === '/api/canonical/guide-bindings') return send({ bindings: empty ? [] : guides });
      if (url.pathname === '/api/output-profiles') {
        if (req.method === 'POST') {
          const profile = { slug: `lineup-${profiles.length}`, name: data.name, enabled: data.enabled ?? true, isDefault: false };
          profiles.push(profile);
          entries[profile.slug] = structuredClone(entries[data.copyFromSlug || 'default']);
          return send({ profile });
        }
        return send({ profiles });
      }
      if (url.pathname.startsWith('/api/reload/')) {
        const isGuide = url.pathname.endsWith('/epg');
        await new Promise(resolve => setTimeout(resolve, auditFlags[isGuide ? 'guideReloadDelayMs' : 'channelReloadDelayMs']));
        if (auditFlags[isGuide ? 'failGuideReload' : 'failChannelReload']) return send({ error: `Synthetic ${isGuide ? 'guide' : 'channel'} reload failed` }, 503);
        return send({ channels: channels.length, status: 'ok' });
      }
      const match = url.pathname.match(/^\/api\/output-profiles\/([^/]+)(?:\/(entries|channels))?$/);
      if (match) {
        const slug = match[1];
        if (req.method === 'DELETE') {
          const index = profiles.findIndex(profile => profile.slug === slug);
          if (index >= 0) profiles.splice(index, 1);
          delete entries[slug];
          return send({ status: 'deleted' });
        }
        if (req.method === 'PUT') {
          if (failSave) return send({ error: 'Fixture validation failed for metv', canonicalId: 'metv' }, 400);
          if (data.profile) Object.assign(profiles.find(profile => profile.slug === slug), data.profile);
          for (const change of data.canonicalChannels || []) {
            const channel = channels.find(item => item.id === change.id);
            if ('customName' in change) { channel.customName = change.customName || null; channel.name = channel.customName || channel.baseName; }
            if ('preferredSourceChannelId' in change) bindings.filter(item => item.canonical.id === change.id).forEach(item => { item.isPreferredStream = item.sourceChannel.id === change.preferredSourceChannelId; });
            if (change.guideBinding) guides.filter(item => item.canonical.id === change.id).forEach(item => { item.selected = item.source.id === change.guideBinding.sourceId; if (item.selected) item.epgChannelId = change.guideBinding.epgChannelId; });
          }
          for (const change of data.channels || []) Object.assign(entries[slug].find(entry => entry.canonical.id === change.canonicalId), change);
          if (failReadAfterSave) failRead = true;
          return send({ status: 'saved', profile: profiles.find(profile => profile.slug === slug), channels: entries[slug] });
        }
        if (match[2] === 'channels') {
          if (auditFlags.failPreview) return send({ error: 'Synthetic preview lineup failed' }, 503);
          return send({ channels: empty ? [] : (entries[slug] || []).filter(entry => entry.enabled).map(entry => ({
            ...channels.find(channel => channel.id === entry.canonical.id), canonicalId: entry.canonical.id,
            guideNumber: entry.guideNumberOverride || entry.canonical.guideNumber, source: 'Antenna',
            sourceChannelId: `${entry.canonical.id}-antenna`, streamName: entry.canonical.baseName,
            original_url: `http://127.0.0.1:5178/stream/channel/${entry.canonical.id}-antenna`,
            logo: '', group: 'Synthetic audit channels', position: entry.position,
          })) });
        }
        return send({ channels: empty ? [] : entries[slug] });
      }
      send({ error: `Unhandled fixture route: ${url.pathname}` }, 404);
    });
  } }],
  server: { host: '127.0.0.1', port: 5178, strictPort: true },
});
await server.listen();
console.log('Isolated Channels preview: http://127.0.0.1:5178/admin/');
