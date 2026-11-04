import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as experience from '../../admin/src/utils/admin-experience.js';

describe('admin experience', () => {
  it('keeps partial guide failures actionable even when the HTTP request succeeded', () => {
    expect(experience.guideRefreshProblem({ status: 'ok' })).to.equal('');
    expect(
      experience.guideRefreshProblem({
        status: 'degraded',
        sources: [
          { source: 'Antenna', status: 'ok' },
          { source: 'Backup', status: 'stale', error: 'Timed out' },
        ],
      })
    ).to.equal('Guide partially refreshed. Backup: using cached guide (Timed out)');
    expect(experience.guideRefreshProblem({ status: 'degraded', sources: [] })).to.include(
      'Check source guide URLs'
    );
  });
  it('links health identifiers only when a single channel owns the match', () => {
    const channels = [
      { id: 'a', name: 'News', sourceBindings: [{ sourceChannel: { tvg_id: 'news.hd' } }] },
      { id: 'b', name: 'Weather' },
    ];
    expect(experience.resolveHealthChannel('news.hd', channels)?.id).to.equal('a');
    expect(experience.resolveHealthChannel('Weather', channels)?.id).to.equal('b');
    expect(experience.resolveHealthChannel('missing', channels)).to.equal(null);
    expect(
      experience.resolveHealthChannel('News', [...channels, { id: 'c', name: 'News' }])
    ).to.equal(null);
  });
  it('keeps a refresh failure when another stage finishes successfully later', async () => {
    let finishGuide;
    const updates = [];
    const pending = experience.runRefreshStages(
      {
        channels: async () => {
          throw new Error('Source offline');
        },
        guide: () =>
          new Promise(resolve => {
            finishGuide = resolve;
          }),
      },
      update => updates.push(update)
    );
    await Promise.resolve();
    finishGuide();
    const outcomes = await pending;
    expect(outcomes.channels).to.deep.equal({ status: 'error', message: 'Source offline' });
    expect(outcomes.guide.status).to.equal('success');
    expect(updates.at(-1)).to.deep.equal(outcomes);
    expect(updates[0].channels.status).to.equal('running');
  });

  it('reports both refresh failures rather than rejecting at the first failure', async () => {
    const outcomes = await experience.runRefreshStages({
      channels: async () => {
        throw new Error('Channels failed');
      },
      guide: async () => {
        throw new Error('Guide failed');
      },
    });
    expect(outcomes.channels.message).to.equal('Channels failed');
    expect(outcomes.guide.message).to.equal('Guide failed');
  });

  it('observes native playback failures and detaches when the player is replaced', () => {
    const video = new EventTarget();
    video.error = { code: 2 };
    const failures = [];
    const cleanup = experience.observeNativePlayback(video, failure => failures.push(failure));
    video.dispatchEvent(new Event('error'));
    expect(failures[0].kind).to.equal('network');
    video.error = { code: 3 };
    video.dispatchEvent(new Event('error'));
    expect(failures[1].kind).to.equal('codec');
    cleanup();
    video.dispatchEvent(new Event('error'));
    expect(failures).to.have.length(2);
  });

  it('does not report an intentionally aborted player as a playback failure', () => {
    const video = new EventTarget();
    video.error = { code: 1 };
    const failures = [];
    const cleanup = experience.observeNativePlayback(video, failure => failures.push(failure));
    video.dispatchEvent(new Event('error'));
    expect(failures).to.deep.equal([]);
    cleanup();
  });

  it('restores valid sections and uses Channels for empty or unknown routes', () => {
    expect(experience.readAdminSection('#preview')).to.equal('preview');
    expect(experience.readAdminSection('#settings')).to.equal('app');
    expect(experience.readAdminSection('#app')).to.equal('app');
    expect(experience.readAdminSection('#unknown')).to.equal('channels');
    expect(experience.readAdminSection('')).to.equal('channels');
  });

  it('parses backup timestamps with or without collision suffixes as UTC', () => {
    for (const value of ['backup-2026-11-01T02-00-00', 'backup-2026-11-01T02-00-00-365837']) {
      expect(experience.parseBackupDate(value)?.toISOString()).to.equal('2026-11-01T02:00:00.000Z');
    }
    expect(experience.parseBackupDate('unknown')).to.equal(null);
    expect(experience.parseBackupDate('backup-2026-99-01T02-00-00')).to.equal(null);
  });
});
