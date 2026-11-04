// Local-only manual UX harness. No real providers, database, or production requests.
// Run: node test/fixtures/admin-channels-preview.mjs
import { createServer } from '../../admin/node_modules/vite/dist/node/index.js';
import vue from '../../admin/node_modules/@vitejs/plugin-vue/dist/index.mjs';
import { fileURLToPath } from 'node:url';

let empty = false;
let failSave = false;
let failRead = false;
let failReadAfterSave = false;
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
const entries = Object.fromEntries(profiles.map(profile => [profile.slug, channels.map((channel, i) => ({ canonical: channel, enabled: channel.id !== 'great', position: i, guideNumberOverride: null }))]));
const requests = [];

const server = await createServer({
  root: fileURLToPath(new URL('../../admin', import.meta.url)), configFile: false,
  base: '/admin/', plugins: [vue(), { name: 'isolated-channel-fixtures', configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (!url.pathname.startsWith('/api/') && url.pathname !== '/__fixture') return next();
      res.setHeader('Content-Type', 'application/json');
      const send = (value, status = 200) => { res.statusCode = status; res.end(JSON.stringify(value)); };
      if (url.pathname === '/__fixture') {
        if (url.searchParams.has('empty')) empty = url.searchParams.get('empty') === 'true';
        if (url.searchParams.has('failSave')) failSave = url.searchParams.get('failSave') === 'true';
        if (url.searchParams.has('failRead')) failRead = url.searchParams.get('failRead') === 'true';
        if (url.searchParams.has('failReadAfterSave')) failReadAfterSave = url.searchParams.get('failReadAfterSave') === 'true';
        return send({ empty, failSave, failRead, failReadAfterSave, requests });
      }
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = body ? JSON.parse(body) : {};
      requests.push({ method: req.method, path: url.pathname, body: data });
      if (url.pathname === '/api/auth/status') return send({ configured: true });
      if (url.pathname === '/api/auth/session') return send({ authenticated: true });
      if (url.pathname === '/api/auth/csrf-token') return send({ csrfToken: 'local-fixture' });
      if (url.pathname === '/api/config/app') return send({ base_url: 'http://127.0.0.1:5178', oauth: {} });
      if (url.pathname === '/api/config/providers') return send({ providers: [{ name: 'Antenna', type: 'm3u', url: 'http://fixture.invalid/lineup.m3u' }] });
      if (url.pathname === '/api/config/backups') return send({ backups: [] });
      if (url.pathname === '/api/usage/active') return send({ active: [] });
      if (url.pathname === '/api/channel-health') return send({ details: [], summary: {} });
      if (url.pathname === '/api/scheduler/jobs') return send({ jobs: [] });
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
      if (url.pathname.startsWith('/api/reload/')) return send({ channels: channels.length, status: 'ok' });
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
        return send({ channels: empty || match[2] === 'channels' ? [] : entries[slug] });
      }
      send({ error: `Unhandled fixture route: ${url.pathname}` }, 404);
    });
  } }],
  server: { host: '127.0.0.1', port: 5178, strictPort: true },
});
await server.listen();
console.log('Isolated Channels preview: http://127.0.0.1:5178/admin/');
