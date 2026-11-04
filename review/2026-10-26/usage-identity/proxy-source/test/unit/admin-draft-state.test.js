import { describe, it } from 'mocha';
import { expect } from 'chai';
import {
  cloneOutputProfileDraftState,
  hasGuideNumberDraftChanges,
  normalizeAppDraftForComparison,
  normalizeChannelWorkflowDraftsForComparison,
  normalizeOutputProfileEntriesForComparison,
  normalizeProvidersForComparison,
} from '../../admin/src/utils/admin-draft-state.js';

describe('admin draft state helpers', () => {
  it('normalizes app drafts without UI-only client ids', () => {
    const result = normalizeAppDraftForComparison({
      base_url: 'https://iptv.example.com',
      oauth: {
        issuer: 'https://iptv.example.com',
        authorization_code_ttl_seconds: '300',
        access_token_ttl_seconds: '3600',
        clients: [
          {
            _id: 'oauth-ui-1',
            client_id: 'chatgpt',
            client_name: 'ChatGPT',
            redirectUrisText: 'https://chatgpt.com/aip/oauth/callback',
            scope: 'mcp',
          },
        ],
      },
    });

    expect(result).to.deep.equal({
      base_url: 'https://iptv.example.com',
      oauth: {
        issuer: 'https://iptv.example.com',
        authorization_code_ttl_seconds: '300',
        access_token_ttl_seconds: '3600',
        clients: [
          {
            client_id: 'chatgpt',
            client_name: 'ChatGPT',
            redirectUrisText: 'https://chatgpt.com/aip/oauth/callback',
            scope: 'mcp',
          },
        ],
      },
    });
  });

  it('normalizes provider drafts without row ids', () => {
    const result = normalizeProvidersForComparison([
      {
        _id: 'prov_1',
        name: 'Primary',
        type: 'm3u',
        url: 'https://example.com/playlist.m3u',
        epg: 'https://example.com/guide.xml',
      },
    ]);

    expect(result).to.deep.equal([
      {
        name: 'Primary',
        type: 'm3u',
        url: 'https://example.com/playlist.m3u',
        epg: 'https://example.com/guide.xml',
      },
    ]);
  });

  it('detects unsaved guide number input before blur commits it', () => {
    expect(
      hasGuideNumberDraftChanges([
        {
          guideNumberOverride: null,
          guideNumberOverrideDraft: ' 105 ',
        },
      ])
    ).to.equal(true);
  });

  it('normalizes output profile entries for stable comparisons', () => {
    const result = normalizeOutputProfileEntriesForComparison([
      {
        canonical: { id: '2' },
        enabled: true,
        position: 4,
        guideNumberOverride: ' 205 ',
      },
      {
        canonical: { id: '1' },
        enabled: false,
        position: 1,
        guideNumberOverride: '',
      },
    ]);

    expect(result).to.deep.equal([
      {
        canonicalId: '1',
        enabled: false,
        position: 1,
        guideNumberOverride: null,
      },
      {
        canonicalId: '2',
        enabled: true,
        position: 4,
        guideNumberOverride: '205',
      },
    ]);
  });

  it('normalizes channel workflow drafts without trimming custom channel names', () => {
    const result = normalizeChannelWorkflowDraftsForComparison([
      {
        canonicalId: '23.1',
        customNameDraft: '  My Channel  ',
        preferredSourceChannelId: 'source-a',
        selectedGuideBindingValue: 'guide-a',
      },
      {
        canonicalId: '10.1',
        customNameDraft: null,
        preferredSourceChannelId: '',
        selectedGuideBindingValue: '',
      },
    ]);

    expect(result).to.deep.equal([
      {
        canonicalId: '10.1',
        customNameDraft: '',
        preferredSourceChannelId: '',
        selectedGuideBindingValue: '',
      },
      {
        canonicalId: '23.1',
        customNameDraft: '  My Channel  ',
        preferredSourceChannelId: 'source-a',
        selectedGuideBindingValue: 'guide-a',
      },
    ]);
  });

  it('clones output profile draft state for storage', () => {
    const result = cloneOutputProfileDraftState({
      selectedOutputProfileSlug: 'sports',
      outputProfileDraft: { name: 'Sports', enabled: true },
      outputProfileEntries: [
        {
          canonical: { id: '23.1' },
          enabled: true,
          position: 2,
          guideNumberOverride: null,
          guideNumberOverrideDraft: '500',
        },
      ],
    });

    expect(result).to.deep.equal({
      selectedOutputProfileSlug: 'sports',
      outputProfileDraft: { name: 'Sports', enabled: true },
      outputProfileEntries: [
        {
          canonicalId: '23.1',
          enabled: true,
          position: 2,
          guideNumberOverride: null,
          guideNumberOverrideDraft: '500',
        },
      ],
      channelDrafts: [],
    });
  });
});
