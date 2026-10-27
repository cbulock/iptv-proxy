import getBaseUrl from '../libs/getBaseUrl.js';

function normalizeConfiguredBaseUrl(baseUrl) {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    return '';
  }

  try {
    const url = new URL(baseUrl.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return '';
    }
    return url.toString().replace(/\/+$/, '');
  } catch (_err) {
    return '';
  }
}

/**
 * Resolve the public URL advertised to HDHomeRun clients.
 *
 * A configured base_url is authoritative for reverse proxies and externally
 * published deployments. Otherwise use the request origin, which retains the
 * LAN host and listener port supplied by the client (including trusted proxy
 * headers). The final fallback exists only for non-HTTP test callers.
 *
 * @param {import('express').Request} req
 * @param {{base_url?: string, host?: string, port?: number}} config
 * @returns {string}
 */
export function getHDHRBaseUrl(req, config = {}) {
  const configuredBaseUrl = normalizeConfiguredBaseUrl(config.base_url);
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  const requestBaseUrl = getBaseUrl(req);
  if (requestBaseUrl) {
    return requestBaseUrl.replace(/\/+$/, '');
  }

  const host = config.host || 'localhost';
  const port = config.port || process.env.PORT || 34400;
  return `http://${host}:${port}`;
}

export function setupHDHRRoutes(app, config) {
  app.get('/discover.json', (req, res) => {
    const baseURL = getHDHRBaseUrl(req, config);
    res.json({
      FriendlyName: 'IPTV Proxy',
      ModelNumber: 'HDHR3-US',
      FirmwareName: 'iptv_proxy',
      FirmwareVersion: '20250620',
      DeviceID: '12345678',
      DeviceAuth: 'abcdef123456',
      BaseURL: baseURL,
      LineupURL: `${baseURL}/lineup.json`,
    });
  });

  app.get('/lineup_status.json', (req, res) => {
    res.json({
      ScanInProgress: 0,
      ScanPossible: 1,
      Source: 'Cable',
      SourceList: ['Cable'],
    });
  });
}
