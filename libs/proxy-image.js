import axios from 'axios';
import getBaseUrl from './getBaseUrl.js';

export function getProxiedImageUrl(originalUrl, source, req) {
  if (!originalUrl) return '';
  return `${getBaseUrl(req)}/images/${encodeURIComponent(source)}/${encodeURIComponent(originalUrl)}`;
}

export function imageProxyRoute(app) {
  app.get('/images/:source/:url', async (req, res) => {
    const decodedUrl = decodeURIComponent(req.params.url);
    try {
      const response = await axios.get(decodedUrl, { responseType: 'stream' });
      res.set(response.headers);
      response.data.pipe(res);
    } catch (err) {
      console.warn(`Failed to fetch image from ${decodedUrl}: ${err.message}`);
      res.status(502).send(`Failed to fetch image`);
    }
  });
}
