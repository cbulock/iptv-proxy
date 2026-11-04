import { describe, it, afterEach } from 'mocha';
import { expect } from 'chai';
import sinon from 'sinon';
import dns from 'dns';
import { artworkDestination, channelProjection, publishedGuidePage } from '../../server/live-tv.js';

describe('Published projection boundaries', () => {
  afterEach(() => sinon.restore());
  it('uses the channel name for guide lookup when its TVG ID is empty', () => {
    const channel = { canonicalId: 'ocho-test', name: 'ESPN: The Ocho', tvg_id: '' };
    const snapshot = {
      revision: 'fallback-test',
      programmes: new Map([[channel.name, [{
        '@_start': '20261025200000 -0400',
        '@_stop': '20261025210000 -0400',
        title: 'Web guide test',
      }]]]),
    };
    const page = publishedGuidePage([channel], snapshot, { hours: 24 }, Date.parse('2026-10-25T23:30:00Z'));
    expect(page.programmes).to.have.length(1);
    expect(page.programmes[0]).to.include({ channelId: channel.canonicalId, title: 'Web guide test' });
  });
  it('allows private addresses only for exact configured source hosts and rejects unsafe DNS answers', async () => {
    const sources = [
      { url: 'https://tunarr.example/playlist', epg: 'https://guide.example/guide' },
    ];
    sinon
      .stub(dns, 'lookup')
      .callsFake((host, options, callback) =>
        callback(null, [{ address: '127.0.0.1', family: 4 }])
      );
    const destination = artworkDestination('https://tunarr.example/logo', sources);
    const error = await new Promise(resolve =>
      destination.lookup('tunarr.example', {}, err => resolve(err))
    );
    expect(error).to.be.instanceOf(Error);
    dns.lookup.callsFake((host, options, callback) =>
      callback(null, [{ address: '192.168.1.4', family: 4 }])
    );
    const result = await new Promise((resolve, reject) =>
      destination.lookup('tunarr.example', {}, (err, ip) => (err ? reject(err) : resolve(ip)))
    );
    expect(result).to.equal('192.168.1.4');
    for (const url of [
      'http://127.1/logo',
      'http://[::1]/logo',
      'http://[::ffff:127.0.0.1]/logo',
      'http://169.254.169.254/logo',
    ]) {
      expect(artworkDestination(url, [{ url }])).to.equal(null);
    }
  });
  it('detects HLS path/query and HDHomeRun without guessing other formats', () => {
    const project = c => channelProjection({ canonicalId: 'one', ...c }, new Map());
    expect(project({ original_url: 'https://example/a.m3u8?token=secret' }).formatHint).to.equal(
      'hls'
    );
    expect(project({ original_url: 'http://local/video', type: 'hdhomerun' }).formatHint).to.equal(
      'ts'
    );
    expect(project({ original_url: 'https://example/video' }).formatHint).to.equal('unknown');
  });
  it('infers a missing stop only from a reasonable next same-channel start', () => {
    const from = Date.parse('2026-10-24T00:00:00Z');
    const channels = [{ canonicalId: 'one', tvg_id: 'one' }];
    const snapshot = {
      revision: 'one',
      programmes: new Map([
        [
          'one',
          [
            { '@_start': '20261024010000 -0400', title: 'First' },
            { '@_start': '20261024060000 +0000', title: 'Second' },
            { '@_start': '20261025060000 +0000', title: 'Third' },
            { '@_start': '20261325060000 +0000', title: 'Invalid' },
          ],
        ],
      ]),
    };
    const page = publishedGuidePage(channels, snapshot, {}, from);
    expect(page.programmes).to.have.length(3);
    expect(page.programmes[0].start).to.equal('2026-10-24T05:00:00.000Z');
    expect(page.programmes[0].stop).to.equal('2026-10-24T06:00:00.000Z');
    expect(page.programmes[1].stop).to.equal(null);
    expect(page.programmes[2].stop).to.equal(null);
  });
});
