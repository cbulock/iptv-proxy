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

  const host = req.get('X-Forwarded-Host') || req.get('host');

  return `${protocol}://${host}`;
}