import { describe, it } from 'mocha';
import { expect } from 'chai';
import {
  matchesChannelSearch,
  getChannelSetupIssues,
  buildChannelChangeReview,
  restoreChannelDrafts,
  resolveChannelDraftGuard,
  saveChannelDrafts,
} from '../../admin/src/utils/channel-workflow.js';

describe('channel authoring workflow', () => {
  it('finds the number shown in the lineup as well as names and source references', () => {
    const row = {
      name: 'MeTV',
      effectiveGuideNumber: '11',
      sourceBindingsSummary: 'Antenna',
      sourceGuideReferencesSummary: '10.2',
    };
    for (const query of ['11', 'metv', ' ANTENNA ', '10.2', '']) {
      expect(matchesChannelSearch(row, query), query).to.equal(true);
    }
    expect(matchesChannelSearch(row, 'CNN')).to.equal(false);
  });

  it('includes excluded channels without a number in setup and distinguishes unselected sources', () => {
    const row = {
      outputEnabled: false,
      preferredStreamOptions: [{ value: 'a' }],
      guideBindingOptions: [{ value: 'g' }],
    };
    expect(getChannelSetupIssues(row).map(issue => issue.key)).to.deep.equal([
      'number',
      'stream-selection',
      'guide-selection',
    ]);
    expect(
      getChannelSetupIssues({
        ...row,
        effectiveGuideNumber: '6',
        preferredSourceChannelId: 'a',
        selectedGuideBindingValue: 'g',
      })
    ).to.deep.equal([]);
    expect(
      getChannelSetupIssues({ effectiveGuideNumber: '6' }).map(issue => issue.key)
    ).to.deep.equal(['stream-unavailable', 'guide-unavailable']);
  });

  it('reviews shared and lineup edits separately, including unblurred number text', () => {
    const rows = [
      {
        id: 'metv',
        name: 'MeTV',
        baseName: 'MeTV',
        customName: null,
        customNameDraft: 'My TV',
        customNameDirty: true,
        outputEnabled: true,
        savedOutputEnabled: false,
        guideNumberOverrideInput: ' 42 ',
        savedGuideNumberOverride: null,
        committedPreferredSourceChannelId: 'a',
        preferredSourceChannelId: 'b',
        preferredStreamDirty: true,
        preferredStreamOptions: [
          { value: 'a', label: 'Antenna' },
          { value: 'b', label: 'Cable' },
        ],
      },
    ];
    const review = buildChannelChangeReview(
      rows,
      { name: 'New', enabled: false },
      { name: 'Old', enabled: true }
    );
    expect(review.shared[0].changes.map(c => [c.field, c.before, c.after])).to.deep.equal([
      ['Display name', 'MeTV', 'My TV'],
      ['Stream source', 'Antenna', 'Cable'],
    ]);
    expect(review.lineup[0].changes.map(c => [c.before, c.after])).to.deep.equal([
      ['Not included', 'Included'],
      ['Use default', '42'],
    ]);
    expect(review.profile).to.have.length(2);
  });

  it('discard restores every draft without changing or aliasing saved entries', () => {
    const savedEntries = [{ canonical: { id: 'a' }, enabled: false, guideNumberOverride: null }];
    const state = {
      outputProfileDraft: { name: 'Draft' },
      outputProfileEntries: [],
      canonicalChannels: [{ id: 'a', customName: 'Saved', customNameDraft: 'Draft' }],
      channelBindings: [
        { canonical: { id: 'a' }, sourceChannel: { id: 'stream-a' }, isPreferredStream: true },
      ],
      guideBindings: [
        { canonical: { id: 'a' }, source: { id: 'guide-a' }, epgChannelId: '6.1', selected: true },
      ],
      preferredStreamDrafts: { a: 'wrong' },
      guideBindingDrafts: { a: 'wrong' },
      channelRowFeedback: { a: { tone: 'danger' } },
    };
    restoreChannelDrafts(state, { name: 'Default', enabled: true }, savedEntries);
    expect(state.outputProfileDraft).to.deep.equal({ name: 'Default', enabled: true });
    expect(state.canonicalChannels[0].customNameDraft).to.equal('Saved');
    expect(state.outputProfileEntries[0].guideNumberOverrideDraft).to.equal('');
    expect(state.preferredStreamDrafts.a).to.equal('stream-a');
    expect(JSON.parse(state.guideBindingDrafts.a)).to.deep.equal({
      sourceId: 'guide-a',
      epgChannelId: '6.1',
    });
    expect(state.channelRowFeedback).to.deep.equal({});
    state.outputProfileEntries[0].canonical.id = 'changed';
    expect(savedEntries[0].canonical.id).to.equal('a');
  });

  it('blocks a pending action on cancel or failed save and only discards explicitly', async () => {
    let discarded = false;
    const options = {
      isDirty: () => true,
      prompt: async () => 'cancel',
      save: async () => false,
      discard: () => {
        discarded = true;
      },
    };
    expect(await resolveChannelDraftGuard(options)).to.equal(false);
    expect(await resolveChannelDraftGuard({ ...options, prompt: async () => 'save' })).to.equal(
      false
    );
    expect(discarded).to.equal(false);
    expect(await resolveChannelDraftGuard({ ...options, prompt: async () => 'discard' })).to.equal(
      true
    );
    expect(discarded).to.equal(true);
  });

  it('continues after successful save or when clean without prompting', async () => {
    expect(
      await resolveChannelDraftGuard({
        isDirty: () => true,
        prompt: async () => 'save',
        save: async () => true,
      })
    ).to.equal(true);
    expect(
      await resolveChannelDraftGuard({
        isDirty: () => false,
        prompt: () => {
          throw new Error('unexpected');
        },
      })
    ).to.equal(true);
  });

  it('retains drafts on a failed write and acknowledges a saved write before a failed refresh', async () => {
    let acknowledged = false;
    let reloaded = false;
    try {
      await saveChannelDrafts({
        write: async () => {
          throw new Error('validation');
        },
        acknowledge: () => {
          acknowledged = true;
        },
        reload: () => {
          reloaded = true;
        },
      });
      expect.fail('write must reject');
    } catch (error) {
      expect(error.message).to.equal('validation');
    }
    expect(acknowledged).to.equal(false);
    expect(reloaded).to.equal(false);
    const result = await saveChannelDrafts({
      write: async () => ({ saved: true }),
      acknowledge: () => {
        acknowledged = true;
      },
      reload: async () => false,
    });
    expect(result).to.deep.equal({ saved: true, refreshed: false });
    expect(acknowledged).to.equal(true);
  });
});
