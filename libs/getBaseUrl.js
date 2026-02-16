/**
 * Get the base URL for the request, honoring reverse proxy headers
 * Supports X-Forwarded-Proto, X-Forwarded-Host, X-Forwarded-Protocol, X-Url-Scheme, X-Forwarded-Ssl
 * @param {Object} req - Express request object
 * @returns {string} Base URL (e.g., "https://example.com")
 */
export default function getBaseUrl(req) {
  const protocol =
    req.get('X-Forwarded-Proto') ||
    req.get('X-Forwarded-Protocol') ||
    req.get('X-Url-Scheme') ||
    (req.get('X-Forwarded-Ssl') === 'on' ? 'https' : req.protocol);

  // Prefer proxy/forwarded headers, then fall back to Express hostname/headers
  const host =
    req.get('X-Forwarded-Host') ||
    req.get('host') ||
    req.hostname ||
    (req.headers && req.headers.host);

  // If we still cannot determine a host, return empty string so callers can handle it explicitly
  if (!host) {
    return '';
  }

  return `${protocol}://${host}`;
}
