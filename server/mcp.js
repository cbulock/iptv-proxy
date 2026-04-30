import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod';
import { getChannels } from '../libs/channels-cache.js';
import { getGuideData, hasEPGRefresh, refreshEPG } from './epg.js';
import { getSourceStatus } from './status.js';
import { requireAuth } from './auth.js';
import { parseAll } from '../scripts/parseM3U.js';
import { listSources } from '../libs/source-service.js';
import {
  listCanonicalChannels,
  listChannelBindings,
  listGuideBindings,
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
  syncAllOutputProfiles,
  updateOutputProfileEntries,
  updateOutputProfile,
} from '../libs/output-profile-service.js';
import { invalidateLineupCaches } from './lineup.js';

const SERVER_INFO = { name: 'iptv-proxy', version: '1.0.0' };

/**
 * Create a new McpServer instance with all IPTV tools registered.
 * A fresh instance is created per HTTP request (stateless mode).
 */
function createMcpServer() {
  const server = new McpServer(SERVER_INFO);

  // ── list_channels ──────────────────────────────────────────────────────────
  server.tool(
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
      const channels = getChannels();
      let result = channels;

      if (source) {
        result = result.filter(c => c.source === source);
      }
      if (search) {
        const lower = search.toLowerCase();
        result = result.filter(c =>
          String(c.name || '')
            .toLowerCase()
            .includes(lower)
        );
      }

      result = result.slice(0, limit);

      const simplified = result.map(c => ({
        name: c.name,
        source: c.source,
        tvg_id: c.tvg_id || null,
        guideNumber: c.guideNumber || null,
        group: c.group || null,
        logo: c.logo || null,
      }));

      return {
        content: [{ type: 'text', text: JSON.stringify(simplified, null, 2) }],
      };
    }
  );

  // ── get_guide ──────────────────────────────────────────────────────────────
  server.tool(
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
          return {
            content: [
              {
                type: 'text',
                text: 'EPG data is not available yet. Try again after the EPG has been loaded.',
              },
            ],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        console.error('Failed to get guide data for tvg_id:', tvg_id, 'hours:', hours, error);
        return {
          content: [
            {
              type: 'text',
              text: 'Failed to load EPG data due to an internal error. Please try again later or check EPG configuration.',
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── list_providers ─────────────────────────────────────────────────────────
  server.tool(
    'list_providers',
    'List configured IPTV provider sources (M3U playlists and HDHomeRun tuners).',
    {},
    async () => {
      const providers = listSources().map(source => ({
        name: source.name,
        type: source.type || 'm3u',
        hasEpg: Boolean(source.epg),
      }));
      return {
        content: [{ type: 'text', text: JSON.stringify(providers, null, 2) }],
      };
    }
  );

  // ── list_canonical_channels ─────────────────────────────────────────────────
  server.tool(
    'list_canonical_channels',
    'List canonical channels built from mapped source channels.',
    {},
    async () => {
      return {
        content: [{ type: 'text', text: JSON.stringify(listCanonicalChannels(), null, 2) }],
      };
    }
  );

  // ── list_channel_bindings ───────────────────────────────────────────────────
  server.tool(
    'list_channel_bindings',
    'List bindings between discovered source channels and canonical channels.',
    {},
    async () => {
      return {
        content: [{ type: 'text', text: JSON.stringify(listChannelBindings(), null, 2) }],
      };
    }
  );

  // ── list_guide_bindings ──────────────────────────────────────────────────────
  server.tool(
    'list_guide_bindings',
    'List guide bindings between canonical channels and source EPG channel IDs.',
    {},
    async () => {
      return {
        content: [{ type: 'text', text: JSON.stringify(listGuideBindings(), null, 2) }],
      };
    }
  );

  // ── list_output_profiles ────────────────────────────────────────────────────
  server.tool(
    'list_output_profiles',
    'List configured output profiles that define enabled output lineups.',
    {},
    async () => {
      return {
        content: [{ type: 'text', text: JSON.stringify(listOutputProfiles(), null, 2) }],
      };
    }
  );

  server.tool(
    'create_output_profile',
    'Create a new output profile, optionally copying channel settings from an existing profile.',
    {
      name: z.string().min(1).describe('Display name for the new output profile'),
      copyFromSlug: z
        .string()
        .optional()
        .describe('Existing output profile slug to clone from'),
      enabled: z.boolean().optional().describe('Whether the new output profile should be enabled'),
    },
    async ({ name, copyFromSlug, enabled }) => {
      const profile = createOutputProfile({ name, copyFromSlug, enabled });
      if (profile?.error) {
        return {
          content: [{ type: 'text', text: `Failed to create output profile: ${profile.error}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(profile, null, 2) }],
      };
    }
  );

  server.tool(
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
        return {
          content: [{ type: 'text', text: `Failed to update output profile: ${profile.error}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(profile, null, 2) }],
      };
    }
  );

  server.tool(
    'delete_output_profile',
    'Delete a non-default output profile.',
    {
      slug: z.string().min(1).describe('Output profile slug'),
    },
    async ({ slug }) => {
      const result = deleteOutputProfile(slug);
      if (result?.error) {
        return {
          content: [{ type: 'text', text: `Failed to delete output profile: ${result.error}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── get_output_profile_channels ─────────────────────────────────────────────
  server.tool(
    'get_output_profile_channels',
    'List channels currently enabled in an output profile.',
    {
      slug: z.string().default('default').describe('Output profile slug (default: "default")'),
    },
    async ({ slug = 'default' }) => {
      return {
        content: [{ type: 'text', text: JSON.stringify(getOutputProfileChannels(slug), null, 2) }],
      };
    }
  );

  // ── list_output_profile_entries ──────────────────────────────────────────────
  server.tool(
    'list_output_profile_entries',
    'List editable output profile entries, including enabled state and guide number overrides.',
    {
      slug: z.string().default('default').describe('Output profile slug (default: "default")'),
    },
    async ({ slug = 'default' }) => {
      return {
        content: [{ type: 'text', text: JSON.stringify(listOutputProfileEntries(slug), null, 2) }],
      };
    }
  );

  // ── set_canonical_channel_published ─────────────────────────────────────────
  server.tool(
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
          return {
            content: [{ type: 'text', text: `Canonical channel not found: ${id}` }],
            isError: true,
          };
        }

        syncAllOutputProfiles();
        invalidateLineupCaches();
        if (hasEPGRefresh()) {
          await refreshEPG();
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(channel, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Failed to update canonical channel: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // ── set_canonical_channel_preferred_stream ──────────────────────────────────
  server.tool(
    'set_canonical_channel_preferred_stream',
    'Choose which bound source channel should be the preferred stream for a canonical channel.',
    {
      canonical_id: z.string().min(1).describe('Canonical channel ID'),
      source_channel_id: z.string().min(1).describe('Source channel ID to prefer'),
    },
    async ({ canonical_id, source_channel_id }) => {
      try {
        const binding = setCanonicalChannelPreferredStream(canonical_id, source_channel_id);
        if (binding?.error === 'canonical-not-found') {
          return {
            content: [{ type: 'text', text: `Canonical channel not found: ${canonical_id}` }],
            isError: true,
          };
        }
        if (binding?.error === 'binding-not-found') {
          return {
            content: [
              {
                type: 'text',
                text: `Binding not found for canonical channel ${canonical_id} and source channel ${source_channel_id}`,
              },
            ],
            isError: true,
          };
        }

        invalidateLineupCaches();
        if (hasEPGRefresh()) {
          await refreshEPG();
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(binding, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Failed to update preferred stream: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // ── set_canonical_channel_guide_binding ─────────────────────────────────────
  server.tool(
    'set_canonical_channel_guide_binding',
    'Choose which source guide binding and EPG channel ID should drive a canonical channel.',
    {
      canonical_id: z.string().min(1).describe('Canonical channel ID'),
      source_id: z.string().min(1).describe('Source ID to use for guide data'),
      epg_channel_id: z.string().min(1).describe('EPG channel ID from the selected source'),
    },
    async ({ canonical_id, source_id, epg_channel_id }) => {
      try {
        const binding = setCanonicalChannelGuideBinding(canonical_id, source_id, epg_channel_id);
        if (binding?.error === 'canonical-not-found') {
          return {
            content: [{ type: 'text', text: `Canonical channel not found: ${canonical_id}` }],
            isError: true,
          };
        }
        if (binding?.error === 'guide-binding-not-found') {
          return {
            content: [
              {
                type: 'text',
                text: `Guide binding not found for canonical channel ${canonical_id} and source ${source_id}`,
              },
            ],
            isError: true,
          };
        }

        if (hasEPGRefresh()) {
          await refreshEPG();
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(binding, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Failed to update guide binding: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // ── update_output_profile_channels ───────────────────────────────────────────
  server.tool(
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
          return {
            content: [{ type: 'text', text: `Output profile not found: ${slug}` }],
            isError: true,
          };
        }
        if (updatedChannels?.error === 'entry-not-found') {
          return {
            content: [
              {
                type: 'text',
                text: `Output profile entry not found for canonical channel ${updatedChannels.canonicalId}`,
              },
            ],
            isError: true,
          };
        }

        invalidateLineupCaches();
        if (hasEPGRefresh()) {
          await refreshEPG();
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(updatedChannels, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Failed to update output profile channels: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // ── get_status ─────────────────────────────────────────────────────────────
  server.tool(
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
      return {
        content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  // ── reload_channels ────────────────────────────────────────────────────────
  server.tool(
    'reload_channels',
    'Reload channel data from all configured M3U and HDHomeRun sources.',
    {},
    async () => {
      try {
        await parseAll();
        return {
          content: [{ type: 'text', text: 'Channel reload triggered successfully.' }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Channel reload failed: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // ── reload_epg ─────────────────────────────────────────────────────────────
  server.tool(
    'reload_epg',
    'Reload EPG (Electronic Programme Guide) data from all configured XMLTV sources.',
    {},
    async () => {
      try {
        await refreshEPG();
        return {
          content: [{ type: 'text', text: 'EPG reload triggered successfully.' }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `EPG reload failed: ${err.message}` }],
          isError: true,
        };
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
 * Auth is enforced via requireAuth (respects whether auth is enabled in the SQLite-backed app config).
 *
 * @param {import('express').Application} app
 */
export function setupMCPRoutes(app) {
  app.post('/mcp', requireAuth, async (req, res) => {
    const server = createMcpServer();
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless mode
      });
      await server.connect(transport);
      res.on('close', () => {
        transport.close();
        server.close();
      });
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // Reject unsupported GET/DELETE methods with a clear error
  app.get('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. Use POST for MCP requests.' },
      id: null,
    });
  });
}
