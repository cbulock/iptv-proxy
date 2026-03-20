import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod';
import { getChannels } from '../libs/channels-cache.js';
import { loadConfig } from '../libs/config-loader.js';
import { getGuideData, refreshEPG } from './epg.js';
import { getSourceStatus } from './status.js';
import { requireAuth } from './auth.js';
import { parseAll } from '../scripts/parseM3U.js';

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
      limit: z.number().int().min(1).max(500).default(100).describe('Maximum number of channels to return (default 100, max 500)'),
    },
    async ({ source, search, limit = 100 }) => {
      const channels = getChannels();
      let result = channels;

      if (source) {
        result = result.filter(c => c.source === source);
      }
      if (search) {
        const lower = search.toLowerCase();
        result = result.filter(c => String(c.name || '').toLowerCase().includes(lower));
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
      hours: z.number().int().min(1).max(48).default(24).describe('Number of hours of guide data to return (default 24, max 48)'),
    },
    async ({ tvg_id, hours = 24 }) => {
      const data = getGuideData(tvg_id, hours);
      if (data === null) {
        return {
          content: [{ type: 'text', text: 'EPG data is not available yet. Try again after the EPG has been loaded.' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // ── list_providers ─────────────────────────────────────────────────────────
  server.tool(
    'list_providers',
    'List configured IPTV provider sources (M3U playlists and HDHomeRun tuners).',
    {},
    async () => {
      const providersConfig = loadConfig('providers');
      const providers = (providersConfig.providers || []).map(p => ({
        name: p.name,
        type: p.type || 'm3u',
        hasEpg: Boolean(p.epg),
      }));
      return {
        content: [{ type: 'text', text: JSON.stringify(providers, null, 2) }],
      };
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
    'Reload channel data from all configured M3U and HDHomeRun sources. Requires admin authentication.',
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
    'Reload EPG (Electronic Programme Guide) data from all configured XMLTV sources. Requires admin authentication.',
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
 * Auth is enforced via requireAuth (respects whether auth is enabled in app.yaml).
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
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        transport.close();
        server.close();
      });
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
