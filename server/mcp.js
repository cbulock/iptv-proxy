import { getPublishedChannelsData, getPublishedGuideData } from './live-tv.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod';
import { getChannels, invalidateCache } from '../libs/channels-cache.js';
import { getGuideData, hasEPGRefresh, refreshEPG } from './epg.js';
import { getSourceStatus } from './status.js';
import { parseAll } from '../scripts/parseM3U.js';
import { requireMcpBearerAuth } from './oauth.js';
import { listSources, replaceProvidersConfig } from '../libs/source-service.js';
import {
  listCanonicalChannels,
  listChannelBindings,
  listGuideBindings,
  setCanonicalChannelCustomName,
  setCanonicalChannelPublished,
  setCanonicalChannelGuideBinding,
  setCanonicalChannelPreferredStream,
} from '../libs/canonical-channel-service.js';
import {
  createOutputProfile,
  deleteOutputProfile,
  getOutputProfileChannels,
  listOutputProfileEntries,
  listOutputProfiles,
  saveOutputProfile,
  syncAllOutputProfiles,
  updateOutputProfileEntries,
  updateOutputProfile,
} from '../libs/output-profile-service.js';
import { invalidateLineupCaches } from './lineup.js';

const SERVER_INFO = { name: 'iptv-proxy', version: '1.0.0' };

// LAN tuners and local XMLTV/playlist files are supported source locations.
const PROVIDER_URL_SCHEMA = z
  .string()
  .trim()
  .min(1)
  .refine(value => {
    try {
      const url = new URL(value);
      return ['http:', 'https:', 'file:'].includes(url.protocol);
    } catch {
      return false;
    }
  }, 'Expected an HTTP(S) or file URL');
const PROVIDER_FIELDS = {
  name: z.string().trim().min(1).describe('Unique provider display name'),
  url: PROVIDER_URL_SCHEMA.describe(
    'M3U playlist, direct HLS stream, or HDHomeRun base URL; LAN addresses are supported'
  ),
  type: z.enum(['m3u', 'hdhomerun']).describe('Use m3u for playlists and direct HLS streams'),
  epg: z
    .union([PROVIDER_URL_SCHEMA, z.literal('')])
    .describe('XMLTV guide URL; an empty string removes the guide URL'),
};

function saveProvider(tool, { provider_id, ...changes }) {
  try {
    const providers = listSources();
    const current = provider_id ? providers.find(provider => provider.id === provider_id) : null;
    if (provider_id && !current) {
      return createError(tool, {
        code: 'provider-not-found',
        message: `Provider not found: ${provider_id}`,
        nextSuggestedTools: ['list_providers'],
      });
    }
    if (current && Object.keys(changes).length === 0) {
      return createError(tool, {
        code: 'empty-provider-update',
        message: 'Supply at least one provider field to update.',
        nextSuggestedTools: ['list_providers'],
      });
    }
    const next = { ...current, ...changes };
    if (
      providers.some(
        provider =>
          provider.id !== current?.id && provider.name.toLowerCase() === next.name.toLowerCase()
      )
    ) {
      return createError(tool, {
        code: 'provider-name-conflict',
        message: 'A provider with that name already exists.',
        nextSuggestedTools: ['list_providers'],
      });
    }
    replaceProvidersConfig({
      providers: current
        ? providers.map(provider => (provider.id === current.id ? next : provider))
        : [...providers, next],
    });
    const saved = listSources().find(provider =>
      current ? provider.id === current.id : provider.name === next.name
    );
    return createSuccess(
      tool,
      {
        id: saved.id,
        name: saved.name,
        type: saved.type,
        hasEpg: Boolean(saved.epg),
        enabled: saved.enabled,
      },
      {
        summary: `${current ? 'Updated' : 'Created'} provider ${saved.name}. Reload channels and EPG to apply the configuration.`,
        sideEffects: [
          'Provider configuration was saved to SQLite and exported to providers.yaml.',
          'Channels and guide data were not reloaded.',
        ],
        nextSuggestedTools: [
          'reload_channels',
          ...(saved.epg || current?.epg ? ['reload_epg'] : []),
          'diagnose_agent_readiness',
        ],
      }
    );
  } catch (_error) {
    return createError(tool, {
      code: 'provider-save-failed',
      message:
        'Failed to save provider configuration. Inspect the server logs and configuration storage.',
      nextSuggestedTools: ['list_providers'],
    });
  }
}

const WORKFLOW_STEP_SCHEMA = z.object({
  step: z.string(),
  rationale: z.string(),
  suggestedTools: z.array(z.string()),
});

const SUCCESS_RESPONSE_SCHEMA = {
  ok: z.literal(true),
  tool: z.string(),
  summary: z.string(),
  data: z.unknown(),
  sideEffects: z.array(z.string()),
  nextSuggestedTools: z.array(z.string()),
  workflow: z.array(WORKFLOW_STEP_SCHEMA).optional(),
};

function createSuccess(tool, data, options = {}) {
  const structuredContent = {
    ok: true,
    tool,
    summary: options.summary || `${tool} completed successfully.`,
    data,
    sideEffects: options.sideEffects || [],
    nextSuggestedTools: options.nextSuggestedTools || [],
    ...(options.workflow ? { workflow: options.workflow } : {}),
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

function createError(tool, options) {
  const structuredContent = {
    ok: false,
    tool,
    error: {
      code: options.code,
      message: options.message,
      ...(options.details ? { details: options.details } : {}),
    },
    sideEffects: options.sideEffects || [],
    nextSuggestedTools: options.nextSuggestedTools || [],
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
    isError: true,
  };
}

function registerJsonTool(server, name, description, inputSchema, handler) {
  server.registerTool(
    name,
    {
      description,
      inputSchema,
      outputSchema: SUCCESS_RESPONSE_SCHEMA,
    },
    handler
  );
}

function buildWorkflowOverview() {
  return {
    server: SERVER_INFO,
    recommendedEntryTool: 'diagnose_agent_readiness',
    adminOnlyEndpoints: ['/api/usage/active', '/api/usage/history'],
    toolGroups: {
      overview: ['get_agent_workflow', 'diagnose_agent_readiness', 'get_status'],
      discovery: [
        'list_providers',
        'list_channels',
        'list_canonical_channels',
        'list_channel_bindings',
        'list_guide_bindings',
        'list_output_profiles',
        'list_output_profile_entries',
        'get_output_profile_channels',
      ],
      mutation: [
        'create_provider',
        'update_provider',
        'create_output_profile',
        'update_output_profile',
        'save_output_profile',
        'delete_output_profile',
        'set_canonical_channel_name',
        'set_canonical_channel_published',
        'set_canonical_channel_preferred_stream',
        'set_canonical_channel_guide_binding',
        'update_output_profile_channels',
      ],
      refresh: ['reload_channels', 'reload_epg'],
    },
    phases: [
      {
        step: 'Inspect readiness first',
        rationale:
          'Start with a diagnostic summary so the agent can see missing providers, unmapped/inferred bindings, guide coverage, and profile health before making changes.',
        suggestedTools: ['diagnose_agent_readiness', 'get_status'],
      },
      {
        step: 'Inspect discovery and mapping state',
        rationale:
          'Review source channels, canonical channels, and bindings to understand how discovered channels roll up into the published lineup.',
        suggestedTools: [
          'list_providers',
          'list_channels',
          'list_canonical_channels',
          'list_channel_bindings',
          'list_guide_bindings',
        ],
      },
      {
        step: 'Inspect lineup output state',
        rationale:
          'Review output profiles and per-profile entries before changing what downstream clients receive.',
        suggestedTools: [
          'list_output_profiles',
          'list_output_profile_entries',
          'get_output_profile_channels',
        ],
      },
      {
        step: 'Apply targeted mutations',
        rationale:
          'Adjust canonical publish state, preferred streams, guide bindings, or per-profile channel settings only after inspecting current state.',
        suggestedTools: [
          'create_provider',
          'update_provider',
          'set_canonical_channel_published',
          'set_canonical_channel_name',
          'set_canonical_channel_preferred_stream',
          'set_canonical_channel_guide_binding',
          'update_output_profile_channels',
          'save_output_profile',
        ],
      },
      {
        step: 'Refresh and verify',
        rationale:
          'Use reload tools when source or EPG state needs to be rebuilt, then re-run diagnostics or list calls to confirm the resulting state.',
        suggestedTools: ['reload_channels', 'reload_epg', 'diagnose_agent_readiness'],
      },
    ],
    mutationSideEffects: {
      create_provider: [
        'Appends one provider without changing existing sources.',
        'Saves configuration only; reload_channels and reload_epg apply it.',
      ],
      update_provider: [
        'Updates only supplied fields on one provider, preserving its ID and other sources.',
        'Saves configuration only; reload_channels and reload_epg apply it.',
      ],
      create_output_profile: ['Creates profile state and syncs initial output entries.'],
      update_output_profile: ['Updates profile metadata only.'],
      save_output_profile: [
        'Atomically updates profile metadata, canonical choices, and output entries.',
        'Invalidates lineup caches and triggers at most one EPG refresh.',
      ],
      delete_output_profile: ['Removes profile state for that lineup.'],
      set_canonical_channel_name: [
        'Updates the canonical channel display name override.',
        'Invalidates lineup caches.',
        'May trigger an EPG refresh when EPG refresh support is available.',
      ],
      set_canonical_channel_published: [
        'Updates canonical publish state.',
        'Resyncs all output profiles.',
        'Invalidates lineup caches.',
        'May trigger an EPG refresh when EPG refresh support is available.',
      ],
      set_canonical_channel_preferred_stream: [
        'Updates preferred stream selection for the canonical channel.',
        'Invalidates lineup caches.',
        'May trigger an EPG refresh when EPG refresh support is available.',
      ],
      set_canonical_channel_guide_binding: [
        'Updates the selected guide source and EPG channel ID.',
        'May trigger an EPG refresh when EPG refresh support is available.',
      ],
      update_output_profile_channels: [
        'Updates channel order, enabled state, and guide number overrides for one profile.',
        'Invalidates lineup caches.',
        'May trigger an EPG refresh when EPG refresh support is available.',
      ],
      reload_channels: [
        'Reloads discovered channels from configured sources and refreshes the in-memory channel lookup and lineup caches.',
      ],
      reload_epg: ['Reloads guide data from configured XMLTV sources.'],
    },
  };
}

function buildAgentReadiness() {
  const providers = listSources();
  const channels = getChannels();
  const canonicalChannels = listCanonicalChannels();
  const channelBindings = listChannelBindings();
  const guideBindings = listGuideBindings();
  const outputProfiles = listOutputProfiles();
  const status = getSourceStatus();
  const profileSummaries = outputProfiles.map(profile => {
    const entries = listOutputProfileEntries(profile.slug);
    const enabledEntries = entries.filter(entry => entry.enabled);
    const missingGuideNumberEntries = entries.filter(
      entry => !String(entry.guideNumberOverride || entry.canonical?.guideNumber || '').trim()
    );

    return {
      slug: profile.slug,
      name: profile.name,
      enabled: profile.enabled,
      totalEntries: entries.length,
      enabledEntries: enabledEntries.length,
      entriesMissingGuideNumbers: missingGuideNumberEntries.length,
    };
  });

  const discoveredBindings = channelBindings.filter(
    binding => binding.resolutionState !== 'resolved'
  );
  const canonicalIdsWithPreferredStreams = new Set(
    channelBindings
      .filter(binding => binding.isPreferredStream)
      .map(binding => binding.canonical.id)
  );
  const canonicalIdsWithGuideBindings = new Set(guideBindings.map(binding => binding.canonical.id));
  const canonicalChannelsWithoutPreferredStreams = canonicalChannels.filter(
    channel => !canonicalIdsWithPreferredStreams.has(channel.id)
  );
  const canonicalChannelsWithoutGuideBindings = canonicalChannels.filter(
    channel => !canonicalIdsWithGuideBindings.has(channel.id)
  );
  const enabledProfiles = outputProfiles.filter(profile => profile.enabled);
  const enabledProfilesWithoutEnabledChannels = profileSummaries.filter(
    profile => profile.enabled && profile.enabledEntries === 0
  );

  const issues = [];

  if (providers.length === 0) {
    issues.push({
      code: 'no-providers',
      severity: 'error',
      message: 'No IPTV providers are configured, so discovery and lineup output cannot be built.',
      recommendedTools: ['list_providers'],
    });
  }

  if (channels.length === 0) {
    issues.push({
      code: 'no-discovered-channels',
      severity: 'error',
      message: 'No channels are currently discovered from sources.',
      recommendedTools: ['get_status', 'reload_channels', 'list_providers'],
    });
  }

  if (canonicalChannels.length === 0 && channels.length > 0) {
    issues.push({
      code: 'no-canonical-channels',
      severity: 'error',
      message: 'Discovered source channels exist, but no canonical channels are available yet.',
      recommendedTools: ['list_channels', 'list_canonical_channels', 'reload_channels'],
    });
  }

  if (discoveredBindings.length > 0) {
    issues.push({
      code: 'inferred-bindings-present',
      severity: 'warning',
      message: `${discoveredBindings.length} channel bindings are still inferred/discovered instead of explicitly resolved.`,
      recommendedTools: ['list_channel_bindings', 'list_canonical_channels'],
    });
  }

  if (canonicalChannelsWithoutPreferredStreams.length > 0) {
    issues.push({
      code: 'missing-preferred-streams',
      severity: 'warning',
      message: `${canonicalChannelsWithoutPreferredStreams.length} canonical channels do not have a preferred stream selected.`,
      recommendedTools: ['list_channel_bindings', 'set_canonical_channel_preferred_stream'],
    });
  }

  if (canonicalChannelsWithoutGuideBindings.length > 0) {
    issues.push({
      code: 'missing-guide-bindings',
      severity: 'warning',
      message: `${canonicalChannelsWithoutGuideBindings.length} canonical channels do not have any guide binding.`,
      recommendedTools: ['list_guide_bindings', 'set_canonical_channel_guide_binding'],
    });
  }

  if (enabledProfiles.length === 0) {
    issues.push({
      code: 'no-enabled-output-profiles',
      severity: 'error',
      message:
        'No output profiles are enabled, so no lineup is currently published through profiles.',
      recommendedTools: ['list_output_profiles', 'update_output_profile'],
    });
  }

  if (enabledProfilesWithoutEnabledChannels.length > 0) {
    issues.push({
      code: 'enabled-profiles-empty',
      severity: 'warning',
      message: `${enabledProfilesWithoutEnabledChannels.length} enabled output profiles currently have zero enabled channels.`,
      recommendedTools: ['list_output_profile_entries', 'update_output_profile_channels'],
    });
  }

  const recommendedNextActions = issues.length
    ? Array.from(new Set(issues.flatMap(issue => issue.recommendedTools))).slice(0, 6)
    : ['get_status', 'list_output_profiles', 'get_output_profile_channels'];

  return {
    health: issues.some(issue => issue.severity === 'error')
      ? 'needs-attention'
      : issues.length > 0
        ? 'review-recommended'
        : 'ready',
    counts: {
      providers: providers.length,
      discoveredChannels: channels.length,
      canonicalChannels: canonicalChannels.length,
      channelBindings: channelBindings.length,
      inferredBindings: discoveredBindings.length,
      guideBindings: guideBindings.length,
      outputProfiles: outputProfiles.length,
      enabledOutputProfiles: enabledProfiles.length,
    },
    sourceStatus: {
      lastUpdate: status.lastUpdate,
      sources: status.sources,
      recentErrors: status.errors,
    },
    profileSummaries,
    issues,
    recommendedNextActions,
  };
}

function epgRefreshSideEffect() {
  return hasEPGRefresh()
    ? ['EPG refresh was triggered to keep guide output aligned with the new state.']
    : [];
}

/**
 * Create a new McpServer instance with all IPTV tools registered.
 * A fresh instance is created per HTTP request (stateless mode).
 */
function createMcpServer() {
  const server = new McpServer(SERVER_INFO);

  registerJsonTool(
    server,
    'get_agent_workflow',
    'Describe the recommended MCP workflow, tool groups, and side effects so an agent can understand how to operate the IPTV proxy safely.',
    {},
    async () =>
      createSuccess('get_agent_workflow', buildWorkflowOverview(), {
        summary:
          'Returned the recommended inspection, mutation, and refresh workflow for the IPTV proxy MCP interface.',
        nextSuggestedTools: ['diagnose_agent_readiness', 'get_status'],
        workflow: [
          {
            step: 'Start with readiness',
            rationale: 'Use the diagnostic summary before performing detailed reads or mutations.',
            suggestedTools: ['diagnose_agent_readiness'],
          },
          {
            step: 'Inspect then mutate',
            rationale:
              'Review current bindings and profile state first, then apply targeted changes.',
            suggestedTools: [
              'list_channel_bindings',
              'list_guide_bindings',
              'list_output_profile_entries',
            ],
          },
        ],
      })
  );

  registerJsonTool(
    server,
    'diagnose_agent_readiness',
    'Summarize provider, channel, canonical, guide, and output profile state and highlight issues that likely need agent attention.',
    {},
    async () => {
      const readiness = buildAgentReadiness();
      return createSuccess('diagnose_agent_readiness', readiness, {
        summary: `Readiness is ${readiness.health} with ${readiness.issues.length} diagnostic issue(s).`,
        nextSuggestedTools: readiness.recommendedNextActions,
      });
    }
  );

  registerJsonTool(
    server,
    'list_channels',
    'List available IPTV channels. Optionally filter by source provider or search by name.',
    {
      source: z.string().optional().describe('Filter channels by provider source name'),
      search: z.string().optional().describe('Case-insensitive substring search on channel name'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(100)
        .describe('Maximum number of channels to return (default 100, max 500)'),
    },
    async ({ source, search, limit = 100 }) => {
      let result = getChannels();

      if (source) {
        result = result.filter(channel => channel.source === source);
      }
      if (search) {
        const lower = search.toLowerCase();
        result = result.filter(channel =>
          String(channel.name || '')
            .toLowerCase()
            .includes(lower)
        );
      }

      const channels = result.slice(0, limit).map(channel => ({
        // Stable identity for agent-created playback URLs.  Channel names and
        // provider display names can change after a refresh, so consumers
        // should prefer /stream/channel/:sourceChannelId when this is present.
        sourceChannelId: channel.sourceChannelId || null,
        name: channel.name,
        source: channel.source,
        tvg_id: channel.tvg_id || null,
        guideNumber: channel.guideNumber || null,
        group: channel.group || null,
        logo: channel.logo || null,
      }));

      return createSuccess('list_channels', channels, {
        summary: `Returned ${channels.length} discovered channel(s).`,
        nextSuggestedTools: ['list_canonical_channels', 'list_channel_bindings', 'get_status'],
      });
    }
  );

  registerJsonTool(
    server,
    'get_published_channels',
    'Read the default published viewer channel projection with relative stream, transcode, and artwork paths. Transcode paths encode H.264/AAC and deinterlace frames flagged as interlaced, preserving field-rate motion.',
    {},
    async () =>
      createSuccess('get_published_channels', getPublishedChannelsData(), {
        summary: 'Read the published viewer lineup.',
        nextSuggestedTools: ['get_published_guide'],
      })
  );
  registerJsonTool(
    server,
    'get_published_guide',
    'Read all default published guide records in revision-bound pages of up to 1000. Repeat using nextCursor until null; restart on GUIDE_CHANGED.',
    { hours: z.number().int().min(1).max(48).optional(), cursor: z.string().max(2048).optional() },
    async ({ hours, cursor }) => {
      const { status, ...data } = getPublishedGuideData({
        ...(hours === undefined ? {} : { hours }),
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (status)
        return createError('get_published_guide', {
          code: data.code,
          message: data.error,
          nextSuggestedTools: ['get_published_guide'],
        });
      return createSuccess('get_published_guide', data, {
        summary: 'Read a published guide page.',
        nextSuggestedTools: data.nextCursor ? ['get_published_guide'] : [],
      });
    }
  );

  registerJsonTool(
    server,
    'get_guide',
    'Get EPG programme guide data for a specific channel.',
    {
      tvg_id: z.string().describe('TVG ID of the channel to query (e.g. "cnn.us")'),
      hours: z
        .number()
        .int()
        .min(1)
        .max(48)
        .default(24)
        .describe('Number of hours of guide data to return (default 24, max 48)'),
    },
    async ({ tvg_id, hours = 24 }) => {
      try {
        const data = getGuideData(tvg_id, hours);
        if (data === null) {
          return createError('get_guide', {
            code: 'epg-not-loaded',
            message: 'EPG data is not available yet. Try again after the EPG has been loaded.',
            nextSuggestedTools: ['get_status', 'reload_epg'],
          });
        }

        return createSuccess('get_guide', data, {
          summary: `Returned guide data for ${tvg_id} covering up to ${hours} hour(s).`,
          nextSuggestedTools: ['list_guide_bindings', 'diagnose_agent_readiness'],
        });
      } catch (error) {
        console.error('Failed to get guide data for tvg_id:', tvg_id, 'hours:', hours, error);
        return createError('get_guide', {
          code: 'guide-read-failed',
          message:
            'Failed to load EPG data due to an internal error. Please check guide configuration and try again.',
          details: { tvg_id, hours },
          nextSuggestedTools: ['get_status', 'reload_epg'],
        });
      }
    }
  );

  registerJsonTool(
    server,
    'list_providers',
    'List configured IPTV provider sources (M3U playlists and HDHomeRun tuners).',
    {},
    async () => {
      const providers = listSources().map(source => ({
        id: source.id,
        name: source.name,
        type: source.type || 'm3u',
        hasEpg: Boolean(source.epg),
        enabled: source.enabled,
      }));

      return createSuccess('list_providers', providers, {
        summary: `Returned ${providers.length} configured provider source(s).`,
        nextSuggestedTools: ['list_channels', 'get_status', 'diagnose_agent_readiness'],
      });
    }
  );

  registerJsonTool(
    server,
    'create_provider',
    'Add one M3U playlist, direct HLS stream, or HDHomeRun provider with optional XMLTV EPG. Preserves existing sources. Saves configuration only: call reload_channels, inspect canonical channels and guide bindings, then reload_epg. For a direct HLS stream, use set_canonical_channel_guide_binding with the matching XMLTV channel ID and output-profile tools for its guide number. Results omit upstream URLs.',
    {
      name: PROVIDER_FIELDS.name,
      url: PROVIDER_FIELDS.url,
      type: PROVIDER_FIELDS.type.default('m3u'),
      epg: PROVIDER_FIELDS.epg.optional(),
    },
    async args => saveProvider('create_provider', args)
  );

  registerJsonTool(
    server,
    'update_provider',
    'Update supplied fields of one provider by stable ID, preserving other fields and all other sources. An empty epg removes its guide URL. Saves configuration only; call reload_channels and reload_epg afterward. Use list_providers to find the ID. Results omit upstream URLs.',
    {
      provider_id: z.string().min(1).describe('Provider ID from list_providers'),
      name: PROVIDER_FIELDS.name.optional(),
      url: PROVIDER_FIELDS.url.optional(),
      type: PROVIDER_FIELDS.type.optional(),
      epg: PROVIDER_FIELDS.epg.optional(),
    },
    async args => saveProvider('update_provider', args)
  );

  registerJsonTool(
    server,
    'list_canonical_channels',
    'List canonical channels built from mapped source channels.',
    {},
    async () => {
      const channels = listCanonicalChannels();
      return createSuccess('list_canonical_channels', channels, {
        summary: `Returned ${channels.length} canonical channel(s).`,
        nextSuggestedTools: ['list_channel_bindings', 'list_guide_bindings'],
      });
    }
  );

  registerJsonTool(
    server,
    'list_channel_bindings',
    'List bindings between discovered source channels and canonical channels.',
    {},
    async () => {
      const bindings = listChannelBindings();
      return createSuccess('list_channel_bindings', bindings, {
        summary: `Returned ${bindings.length} channel binding(s).`,
        nextSuggestedTools: [
          'diagnose_agent_readiness',
          'set_canonical_channel_preferred_stream',
          'list_canonical_channels',
        ],
      });
    }
  );

  registerJsonTool(
    server,
    'list_guide_bindings',
    'List guide bindings between canonical channels and source EPG channel IDs.',
    {},
    async () => {
      const bindings = listGuideBindings();
      return createSuccess('list_guide_bindings', bindings, {
        summary: `Returned ${bindings.length} guide binding(s).`,
        nextSuggestedTools: ['get_guide', 'set_canonical_channel_guide_binding'],
      });
    }
  );

  registerJsonTool(
    server,
    'list_output_profiles',
    'List configured output profiles that define enabled output lineups.',
    {},
    async () => {
      const profiles = listOutputProfiles();
      return createSuccess('list_output_profiles', profiles, {
        summary: `Returned ${profiles.length} output profile(s).`,
        nextSuggestedTools: ['list_output_profile_entries', 'get_output_profile_channels'],
      });
    }
  );

  registerJsonTool(
    server,
    'create_output_profile',
    'Create a new output profile, optionally copying channel settings from an existing profile.',
    {
      name: z.string().min(1).describe('Display name for the new output profile'),
      copyFromSlug: z.string().optional().describe('Existing output profile slug to clone from'),
      enabled: z.boolean().optional().describe('Whether the new output profile should be enabled'),
    },
    async ({ name, copyFromSlug, enabled }) => {
      const profile = createOutputProfile({ name, copyFromSlug, enabled });
      if (profile?.error) {
        return createError('create_output_profile', {
          code: profile.error,
          message: `Failed to create output profile: ${profile.error}`,
          details: { name, copyFromSlug, enabled },
          nextSuggestedTools: ['list_output_profiles'],
        });
      }

      return createSuccess('create_output_profile', profile, {
        summary: `Created output profile ${profile.slug}.`,
        sideEffects: ['Created profile state and synchronized initial output entries.'],
        nextSuggestedTools: ['list_output_profiles', 'list_output_profile_entries'],
      });
    }
  );

  registerJsonTool(
    server,
    'update_output_profile',
    'Rename an output profile or change whether it is enabled.',
    {
      slug: z.string().min(1).describe('Output profile slug'),
      name: z.string().min(1).optional().describe('New display name for the output profile'),
      enabled: z.boolean().optional().describe('Whether the output profile should be enabled'),
    },
    async ({ slug, name, enabled }) => {
      const profile = updateOutputProfile(slug, { name, enabled });
      if (profile?.error) {
        return createError('update_output_profile', {
          code: profile.error,
          message: `Failed to update output profile: ${profile.error}`,
          details: { slug, name, enabled },
          nextSuggestedTools: ['list_output_profiles'],
        });
      }

      return createSuccess('update_output_profile', profile, {
        summary: `Updated output profile ${profile.slug}.`,
        sideEffects: ['Updated output profile metadata.'],
        nextSuggestedTools: ['list_output_profiles', 'list_output_profile_entries'],
      });
    }
  );

  registerJsonTool(
    server,
    'save_output_profile',
    'Atomically save output profile metadata, canonical choices, and channel entries with at most one EPG refresh.',
    {
      slug: z.string().default('default').describe('Output profile slug (default: "default")'),
      profile: z
        .object({ name: z.string().min(1).optional(), enabled: z.boolean().optional() })
        .optional(),
      canonical_channels: z
        .array(
          z.object({
            id: z.string().min(1),
            custom_name: z.string().nullable().optional(),
            preferred_source_channel_id: z.string().min(1).optional(),
            guide_binding: z
              .object({ source_id: z.string().min(1), epg_channel_id: z.string().min(1) })
              .optional(),
          })
        )
        .optional(),
      channels: z
        .array(
          z.object({
            canonicalId: z.string().min(1),
            position: z.number().int().min(0),
            enabled: z.boolean(),
            guideNumberOverride: z.union([z.string(), z.null()]).optional(),
          })
        )
        .optional(),
    },
    async ({ slug = 'default', profile, canonical_channels: canonicalChannels, channels }) => {
      const result = saveOutputProfile(slug, {
        profile,
        canonicalChannels: (canonicalChannels || []).map(channel => ({
          id: channel.id,
          customName: channel.custom_name,
          preferredSourceChannelId: channel.preferred_source_channel_id,
          guideBinding: channel.guide_binding
            ? {
              sourceId: channel.guide_binding.source_id,
              epgChannelId: channel.guide_binding.epg_channel_id,
            }
            : undefined,
        })),
        channels,
      });
      if (result?.error) {
        return createError('save_output_profile', {
          code: result.error,
          message: `Failed to save output profile: ${result.error}`,
          details: { slug, canonicalId: result.canonicalId },
          nextSuggestedTools: ['list_output_profiles', 'list_output_profile_entries'],
        });
      }

      invalidateLineupCaches();
      if (hasEPGRefresh()) await refreshEPG();
      return createSuccess('save_output_profile', result, {
        summary: `Saved output profile ${slug} atomically.`,
        sideEffects: [
          'Output profile and channel state were updated atomically.',
          'Lineup caches were invalidated.',
          ...epgRefreshSideEffect(),
        ],
        nextSuggestedTools: [
          'list_output_profile_entries',
          'get_output_profile_channels',
          'diagnose_agent_readiness',
        ],
      });
    }
  );

  registerJsonTool(
    server,
    'delete_output_profile',
    'Delete a non-default output profile.',
    {
      slug: z.string().min(1).describe('Output profile slug'),
    },
    async ({ slug }) => {
      const result = deleteOutputProfile(slug);
      if (result?.error) {
        return createError('delete_output_profile', {
          code: result.error,
          message: `Failed to delete output profile: ${result.error}`,
          details: { slug },
          nextSuggestedTools: ['list_output_profiles'],
        });
      }

      return createSuccess('delete_output_profile', result, {
        summary: `Deleted output profile ${slug}.`,
        sideEffects: ['Removed the output profile and its channel entries.'],
        nextSuggestedTools: ['list_output_profiles'],
      });
    }
  );

  registerJsonTool(
    server,
    'get_output_profile_channels',
    'List channels currently enabled in an output profile.',
    {
      slug: z.string().default('default').describe('Output profile slug (default: "default")'),
    },
    async ({ slug = 'default' }) => {
      const channels = getOutputProfileChannels(slug);
      return createSuccess('get_output_profile_channels', channels, {
        summary: `Returned ${channels.length} enabled output channel(s) for profile ${slug}.`,
        nextSuggestedTools: ['list_output_profile_entries', 'list_output_profiles'],
      });
    }
  );

  registerJsonTool(
    server,
    'list_output_profile_entries',
    'List editable output profile entries, including enabled state and guide number overrides.',
    {
      slug: z.string().default('default').describe('Output profile slug (default: "default")'),
    },
    async ({ slug = 'default' }) => {
      const entries = listOutputProfileEntries(slug);
      return createSuccess('list_output_profile_entries', entries, {
        summary: `Returned ${entries.length} editable output profile entr${entries.length === 1 ? 'y' : 'ies'} for ${slug}.`,
        nextSuggestedTools: ['update_output_profile_channels', 'get_output_profile_channels'],
      });
    }
  );

  registerJsonTool(
    server,
    'set_canonical_channel_name',
    'Update or clear the custom display name for a canonical channel.',
    {
      canonical_id: z.string().min(1).describe('Canonical channel ID'),
      custom_name: z
        .string()
        .nullable()
        .optional()
        .describe('Custom display name override; null or empty clears it'),
    },
    async ({ canonical_id, custom_name = null }) => {
      try {
        const channel = setCanonicalChannelCustomName(canonical_id, custom_name);
        if (!channel) {
          return createError('set_canonical_channel_name', {
            code: 'canonical-not-found',
            message: `Canonical channel not found: ${canonical_id}`,
            details: { canonical_id, custom_name },
            nextSuggestedTools: ['list_canonical_channels'],
          });
        }

        invalidateLineupCaches();
        if (hasEPGRefresh()) {
          await refreshEPG();
        }

        return createSuccess('set_canonical_channel_name', channel, {
          summary: `Updated channel name override for canonical channel ${canonical_id}.`,
          sideEffects: [
            'Canonical channel display name override was updated.',
            'Lineup caches were invalidated.',
            ...epgRefreshSideEffect(),
          ],
          nextSuggestedTools: [
            'list_canonical_channels',
            'get_output_profile_channels',
            'diagnose_agent_readiness',
          ],
        });
      } catch (error) {
        return createError('set_canonical_channel_name', {
          code: 'canonical-update-failed',
          message: `Failed to update canonical channel name: ${error.message}`,
          details: { canonical_id, custom_name },
          nextSuggestedTools: ['list_canonical_channels'],
        });
      }
    }
  );

  registerJsonTool(
    server,
    'set_canonical_channel_published',
    'Legacy canonical visibility toggle; updates the canonical channel record and resyncs all output profiles.',
    {
      id: z.string().min(1).describe('Canonical channel ID'),
      published: z.boolean().describe('Legacy canonical visibility flag'),
    },
    async ({ id, published }) => {
      try {
        const channel = setCanonicalChannelPublished(id, published);
        if (!channel) {
          return createError('set_canonical_channel_published', {
            code: 'canonical-not-found',
            message: `Canonical channel not found: ${id}`,
            details: { id, published },
            nextSuggestedTools: ['list_canonical_channels'],
          });
        }

        syncAllOutputProfiles();
        invalidateLineupCaches();
        if (hasEPGRefresh()) {
          await refreshEPG();
        }

        return createSuccess('set_canonical_channel_published', channel, {
          summary: `Updated published state for canonical channel ${id}.`,
          sideEffects: [
            'Canonical channel publish state was updated.',
            'All output profiles were synchronized.',
            'Lineup caches were invalidated.',
            ...epgRefreshSideEffect(),
          ],
          nextSuggestedTools: [
            'list_canonical_channels',
            'list_output_profile_entries',
            'diagnose_agent_readiness',
          ],
        });
      } catch (error) {
        return createError('set_canonical_channel_published', {
          code: 'canonical-update-failed',
          message: `Failed to update canonical channel: ${error.message}`,
          details: { id, published },
          nextSuggestedTools: ['list_canonical_channels'],
        });
      }
    }
  );

  registerJsonTool(
    server,
    'set_canonical_channel_preferred_stream',
    'Choose any discovered source channel as the preferred stream for a canonical channel, creating a persistent manual binding when needed.',
    {
      canonical_id: z.string().min(1).describe('Canonical channel ID'),
      source_channel_id: z.string().min(1).describe('Source channel ID to prefer'),
    },
    async ({ canonical_id, source_channel_id }) => {
      try {
        const binding = setCanonicalChannelPreferredStream(canonical_id, source_channel_id);
        if (binding?.error === 'canonical-not-found') {
          return createError('set_canonical_channel_preferred_stream', {
            code: 'canonical-not-found',
            message: `Canonical channel not found: ${canonical_id}`,
            details: { canonical_id, source_channel_id },
            nextSuggestedTools: ['list_canonical_channels'],
          });
        }
        if (binding?.error === 'binding-not-found') {
          return createError('set_canonical_channel_preferred_stream', {
            code: 'binding-not-found',
            message: `Discovered source channel not found: ${source_channel_id}`,
            details: { canonical_id, source_channel_id },
            nextSuggestedTools: ['list_channel_bindings'],
          });
        }

        invalidateLineupCaches();
        if (hasEPGRefresh()) {
          await refreshEPG();
        }

        return createSuccess('set_canonical_channel_preferred_stream', binding, {
          summary: `Updated preferred stream for canonical channel ${canonical_id}.`,
          sideEffects: [
            'Preferred stream selection was updated.',
            'A persistent manual binding is created when the stream was not already bound to this channel.',
            'Lineup caches were invalidated.',
            ...epgRefreshSideEffect(),
          ],
          nextSuggestedTools: [
            'list_channel_bindings',
            'get_output_profile_channels',
            'diagnose_agent_readiness',
          ],
        });
      } catch (error) {
        return createError('set_canonical_channel_preferred_stream', {
          code: 'preferred-stream-update-failed',
          message: `Failed to update preferred stream: ${error.message}`,
          details: { canonical_id, source_channel_id },
          nextSuggestedTools: ['list_channel_bindings'],
        });
      }
    }
  );

  registerJsonTool(
    server,
    'set_canonical_channel_guide_binding',
    'Choose an EPG-enabled provider and EPG channel ID for a canonical channel, creating a persistent guide binding when needed.',
    {
      canonical_id: z.string().min(1).describe('Canonical channel ID'),
      source_id: z.string().min(1).describe('Source ID to use for guide data'),
      epg_channel_id: z.string().min(1).describe('EPG channel ID from the selected source'),
    },
    async ({ canonical_id, source_id, epg_channel_id }) => {
      try {
        const binding = setCanonicalChannelGuideBinding(canonical_id, source_id, epg_channel_id);
        if (binding?.error === 'canonical-not-found') {
          return createError('set_canonical_channel_guide_binding', {
            code: 'canonical-not-found',
            message: `Canonical channel not found: ${canonical_id}`,
            details: { canonical_id, source_id, epg_channel_id },
            nextSuggestedTools: ['list_canonical_channels'],
          });
        }
        if (binding?.error === 'guide-binding-not-found') {
          return createError('set_canonical_channel_guide_binding', {
            code: 'guide-binding-not-found',
            message: `EPG-enabled source or non-empty EPG channel ID not found: ${source_id}`,
            details: { canonical_id, source_id, epg_channel_id },
            nextSuggestedTools: ['list_guide_bindings'],
          });
        }

        if (hasEPGRefresh()) {
          await refreshEPG();
        }

        return createSuccess('set_canonical_channel_guide_binding', binding, {
          summary: `Updated guide binding for canonical channel ${canonical_id}.`,
          sideEffects: ['Guide binding selection was updated; a persistent binding is created if needed.', ...epgRefreshSideEffect()],
          nextSuggestedTools: ['list_guide_bindings', 'get_guide', 'diagnose_agent_readiness'],
        });
      } catch (error) {
        return createError('set_canonical_channel_guide_binding', {
          code: 'guide-binding-update-failed',
          message: `Failed to update guide binding: ${error.message}`,
          details: { canonical_id, source_id, epg_channel_id },
          nextSuggestedTools: ['list_guide_bindings'],
        });
      }
    }
  );

  registerJsonTool(
    server,
    'update_output_profile_channels',
    'Update output profile channel order, enabled state, and guide number overrides.',
    {
      slug: z.string().default('default').describe('Output profile slug (default: "default")'),
      channels: z
        .array(
          z.object({
            canonicalId: z.string().min(1).describe('Canonical channel ID'),
            position: z.number().int().min(0).describe('Zero-based output position'),
            enabled: z.boolean().describe('Whether the channel is enabled'),
            guideNumberOverride: z
              .union([z.string(), z.null()])
              .optional()
              .describe('Optional guide number override'),
          })
        )
        .describe('Updated output profile entry configuration'),
    },
    async ({ slug = 'default', channels }) => {
      try {
        const updatedChannels = updateOutputProfileEntries(slug, channels);
        if (updatedChannels?.error === 'profile-not-found') {
          return createError('update_output_profile_channels', {
            code: 'profile-not-found',
            message: `Output profile not found: ${slug}`,
            details: { slug },
            nextSuggestedTools: ['list_output_profiles'],
          });
        }
        if (updatedChannels?.error === 'entry-not-found') {
          return createError('update_output_profile_channels', {
            code: 'entry-not-found',
            message: `Output profile entry not found for canonical channel ${updatedChannels.canonicalId}`,
            details: { slug, canonicalId: updatedChannels.canonicalId },
            nextSuggestedTools: ['list_output_profile_entries'],
          });
        }

        invalidateLineupCaches();
        if (hasEPGRefresh()) {
          await refreshEPG();
        }

        return createSuccess('update_output_profile_channels', updatedChannels, {
          summary: `Updated ${channels.length} output profile channel entr${channels.length === 1 ? 'y' : 'ies'} for ${slug}.`,
          sideEffects: [
            'Output profile channel state was updated.',
            'Lineup caches were invalidated.',
            ...epgRefreshSideEffect(),
          ],
          nextSuggestedTools: [
            'list_output_profile_entries',
            'get_output_profile_channels',
            'diagnose_agent_readiness',
          ],
        });
      } catch (error) {
        return createError('update_output_profile_channels', {
          code: 'output-profile-update-failed',
          message: `Failed to update output profile channels: ${error.message}`,
          details: { slug },
          nextSuggestedTools: ['list_output_profile_entries'],
        });
      }
    }
  );

  registerJsonTool(
    server,
    'get_status',
    'Get the current status of channel sources and the last refresh time.',
    {},
    async () => {
      const channels = getChannels();
      const status = getSourceStatus();
      const summary = {
        totalChannels: channels.length,
        lastUpdate: status.lastUpdate,
        sources: status.sources,
        recentErrors: status.errors,
      };

      return createSuccess('get_status', summary, {
        summary: `Returned status for ${channels.length} discovered channel(s).`,
        nextSuggestedTools: ['diagnose_agent_readiness', 'list_channels', 'reload_channels'],
      });
    }
  );

  registerJsonTool(
    server,
    'reload_channels',
    'Reload channel data from all configured M3U and HDHomeRun sources.',
    {},
    async () => {
      try {
        await parseAll();
        await invalidateCache();
        return createSuccess(
          'reload_channels',
          { triggered: true },
          {
            summary: 'Channel reload triggered successfully.',
            sideEffects: [
              'Source channels were reloaded from configured providers.',
              'The in-memory channel lookup and lineup caches were refreshed.',
            ],
            nextSuggestedTools: ['get_status', 'diagnose_agent_readiness', 'list_channels'],
          }
        );
      } catch (error) {
        return createError('reload_channels', {
          code: 'channel-reload-failed',
          message: `Channel reload failed: ${error.message}`,
          nextSuggestedTools: ['get_status', 'list_providers'],
        });
      }
    }
  );

  registerJsonTool(
    server,
    'reload_epg',
    'Reload EPG (Electronic Programme Guide) data from all configured XMLTV sources.',
    {},
    async () => {
      try {
        const outcome = await refreshEPG();
        if (outcome.status === 'failed') {
          return createError('reload_epg', {
            code: 'epg-reload-failed',
            message: outcome.message,
            nextSuggestedTools: ['get_status', 'list_guide_bindings'],
          });
        }
        return createSuccess(
          'reload_epg',
          { triggered: true, status: outcome.status, sources: outcome.sourceResults },
          {
            summary:
              outcome.status === 'degraded'
                ? 'EPG reload completed with stale source data retained.'
                : 'EPG reload completed successfully.',
            sideEffects: [
              outcome.status === 'degraded'
                ? 'Guide data was rebuilt while retaining last-known-good data for failed sources.'
                : 'Guide data was reloaded from configured XMLTV sources.',
            ],
            nextSuggestedTools: ['get_status', 'get_guide', 'diagnose_agent_readiness'],
          }
        );
      } catch (error) {
        return createError('reload_epg', {
          code: 'epg-reload-failed',
          message: `EPG reload failed: ${error.message}`,
          nextSuggestedTools: ['get_status', 'list_guide_bindings'],
        });
      }
    }
  );

  return server;
}

/**
 * Register the MCP endpoint on the given Express app.
 *
 * Endpoint: POST /mcp
 * Uses the MCP Streamable HTTP transport in stateless mode.
 * Auth is enforced via requireMcpBearerAuth (respects whether auth is enabled in the SQLite-backed app config).
 *
 * @param {import('express').Application} app
 */
export function setupMCPRoutes(app) {
  app.post('/mcp', requireMcpBearerAuth, async (req, res) => {
    const server = createMcpServer();
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      res.on('close', () => {
        transport.close();
        server.close();
      });
      await transport.handleRequest(req, res, req.body);
    } catch (_error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. Use POST for MCP requests.' },
      id: null,
    });
  });
}
