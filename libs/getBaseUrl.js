function normalizeLoopbackHost(host) {
  if (!host) {
    return host;
  }

  return String(host).replace(/^127\.0\.0\.1(?=[:]|$)/, 'localhost');
}

/**
 * Get the base URL for the request, honoring reverse proxy headers
 * Supports X-Forwarded-Proto, X-Forwarded-Host, X-Forwarded-Protocol, X-Url-Scheme, X-Forwarded-Ssl
 * @param {Object} req - Express request object
 * @returns {string} Base URL (e.g., "https://example.com")
 */
export default function getBaseUrl(req) {
  // Express resolves protocol and host from forwarded headers only when its
  // configured trust-proxy function accepts the direct peer. Never inspect
  // those headers ourselves for a live Express request.
  const isExpressRequest = Boolean(req.app && typeof req.app.get === 'function');
  const protocol = isExpressRequest
    ? req.protocol
    : req.get('X-Forwarded-Proto') ||
      req.get('X-Forwarded-Protocol') ||
      req.get('X-Url-Scheme') ||
      (req.get('X-Forwarded-Ssl') === 'on' ? 'https' : req.protocol);
  const host = isExpressRequest
    ? req.host || req.get('host')
    : req.get('X-Forwarded-Host') || req.get('host') || req.hostname || (req.headers && req.headers.host);

  // If we still cannot determine a host, return empty string so callers can handle it explicitly
  if (!host) {
    return '';
  }

  return `${protocol}://${normalizeLoopbackHost(host)}`;
}
