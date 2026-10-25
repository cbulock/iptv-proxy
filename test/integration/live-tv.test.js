import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import express from 'express';
import axios from 'axios';
import { Readable } from 'stream';

let setupLiveTvRoutes;
describe('Published Live TV projection', () => {
  let server, base, channels, snapshot, sources, fetchImage;
  beforeEach(async () => {
    ({ setupLiveTvRoutes } = await import('../../server/live-tv.js'));
    channels = [
      {
        canonicalId: 'canonical-1',
        sourceChannelId: 'source-1',
        tvg_id: 'one',
        name: 'A &amp; B',
        guideNumber: '1',
        source: 'Tunarr',
        group: 'TV',
        logo: 'http://192.168.1.4/logo.png',
        original_url: 'http://192.168.1.4/stream?streamMode=hls',
        secret: 'never',
      },
    ];
    sources = [
      {
        name: 'Tunarr',
        url: 'http://192.168.1.4/lineup.m3u',
        epg: 'https://guide.example/xmltv.xml',
      },
    ];
    snapshot = { revision: 'a', programmes: new Map(), icons: new Map() };
    fetchImage = async () => ({
      status: 200,
      headers: { 'content-type': 'image/png' },
      data: Readable.from([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])]),
    });
    const app = express();
    setupLiveTvRoutes(app, {
      getChannels: () => channels,
      getSnapshot: () => snapshot,
      getSources: () => sources,
      fetchImage: (...args) => fetchImage(...args),
    });
    await new Promise(resolve => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterEach(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });
  const get = (base, path) => axios.get(base + path, { validateStatus: () => true });
  it('projects stable IDs and only relative protected paths without provider secrets', async () => {
    const { data } = await get(base, '/channels.json');
    expect(data.channels[0]).to.deep.equal({
      id: 'canonical-1',
      tvgId: 'one',
      name: 'A & B',
      number: '1',
      source: 'Tunarr',
      group: 'TV',
      logo: '/artwork/canonical-1',
      streamUrl: '/stream/channel/source-1',
      transcodeUrl: '/transcode/channel/source-1',
      formatHint: 'hls',
    });
    expect(JSON.stringify(data)).not.to.include('192.168');
  });
  it('paginates all published records and binds cursor to revision, window and membership', async () => {
    const now = Date.now();
    const stamp = value =>
      new Date(value).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
    snapshot.programmes.set(
      'one',
      Array.from({ length: 1005 }, (_, i) => ({
        '@_channel': 'one',
        '@_start': stamp(now + i * 1000),
        '@_stop': stamp(now + 3600000 + i * 1000),
        title: `Show ${i}`,
      }))
    );
    snapshot.programmes.set('unpublished', [{ '@_start': stamp(now), title: 'Secret' }]);
    const first = await get(base, '/guide.json?hours=48');
    expect(first.data.programmes).to.have.length(1000);
    const next = `/guide.json?hours=48&cursor=${encodeURIComponent(first.data.nextCursor)}`;
    const second = await get(base, next);
    expect(second.data.programmes).to.have.length(5);
    expect(second.data.nextCursor).to.equal(null);
    expect(second.data.revision).to.equal(first.data.revision);
    expect(
      new Set([...first.data.programmes, ...second.data.programmes].map(p => p.id)).size
    ).to.equal(1005);
    expect((await get(base, next.replace('hours=48', 'hours=24'))).status).to.equal(400);
    expect((await get(base, '/guide.json?cursor=nonsense')).status).to.equal(400);
    channels = [];
    expect((await get(base, next)).status).to.equal(409);
    channels = [{ canonicalId: 'canonical-1', tvg_id: 'one' }];
    snapshot.revision = 'b';
    expect((await get(base, next)).status).to.equal(409);
  });
  it('rejects cursors after a selected source snapshot changes', async () => {
    const stamp =
      new Date(Date.now() + 60000).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
    snapshot.programmes.set(
      'one',
      Array.from({ length: 1001 }, (_, i) => ({ '@_start': stamp, title: String(i) }))
    );
    const first = await get(base, '/guide.json');
    channels[0].original_url = 'http://192.168.1.4/new-source';
    expect(
      (await get(base, '/guide.json?cursor=' + encodeURIComponent(first.data.nextCursor))).status
    ).to.equal(409);
  });
  it('decodes text and converts UTC without inventing duration for unknown stops', async () => {
    const date = new Date(Date.now() + 60000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
    snapshot.programmes.set('one', [
      {
        '@_start': date + ' +0000',
        title: { '#text': 'Tom &amp; Jerry &#39;TV&#39;' },
        desc: '&lt;b&gt;Plain&lt;/b&gt;',
      },
    ]);
    const { data } = await get(base, '/guide.json');
    expect(data.programmes[0].title).to.equal("Tom & Jerry 'TV'");
    expect(data.programmes[0].description).to.equal('<b>Plain</b>');
    expect(data.programmes[0].stop).to.equal(null);
    expect(data.programmes[0].start).to.match(/Z$/);
  });
  it('only resolves current published artwork IDs and forbids arbitrary path URLs', async () => {
    expect((await get(base, '/artwork/unknown')).status).to.equal(404);
    expect((await get(base, '/artwork/https%3A%2F%2Fevil.example%2Fx')).status).to.equal(404);
    expect((await get(base, '/artwork/canonical-1')).status).to.equal(200);
    channels = [];
    expect((await get(base, '/artwork/canonical-1')).status).to.equal(404);
  });
  it('rejects unapproved destinations, userinfo and metadata hosts', async () => {
    for (const logo of [
      'https://evil.example/x',
      'http://u:p@192.168.1.4/x',
      'http://169.254.169.254/latest',
    ]) {
      channels[0].logo = logo;
      const response = await get(base, '/artwork/canonical-1');
      expect(response.status).to.equal(404);
      expect(JSON.stringify(response.data)).not.to.include(logo);
    }
  });
  it('denies redirects, non-raster MIME and oversized images', async () => {
    for (const response of [
      { status: 302, headers: { location: 'http://127.0.0.1/' } },
      { status: 200, headers: { 'content-type': 'image/svg+xml' } },
      {
        status: 200,
        headers: { 'content-type': 'image/png' },
        data: Readable.from([Buffer.from('<svg/>')]),
      },
      {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': String(6 * 1024 * 1024) },
      },
      {
        status: 200,
        headers: { 'content-type': 'image/png' },
        data: Readable.from([Buffer.alloc(6 * 1024 * 1024)]),
      },
    ]) {
      fetchImage = async () => ({ data: Readable.from([]), ...response });
      expect((await get(base, '/artwork/canonical-1')).status).to.equal(502);
    }
  });
});
