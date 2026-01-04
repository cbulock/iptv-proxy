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
      // Return a more helpful error message
      if (err.response?.status === 404) {
        res.status(404).send(`Image not found: ${decodedUrl}`);
      } else if (err.response?.status === 403) {
        res.status(403).send(`Access denied to image: ${decodedUrl}`);
      } else if (err.code === 'ENOTFOUND') {
        res.status(502).send(`Cannot resolve hostname for image: ${decodedUrl}`);
      } else {
        res.status(502).send(`Failed to fetch image from source`);
      }
    }
  });
}
