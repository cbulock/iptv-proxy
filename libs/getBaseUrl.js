export default function getBaseUrl(req) {
  const protocol =
    req.get('X-Forwarded-Proto') ||
    req.get('X-Forwarded-Protocol') ||
    req.get('X-Url-Scheme') ||
    (req.get('X-Forwarded-Ssl') === 'on' ? 'https' : req.protocol);

  return `${protocol}://${req.get('host')}`;
}