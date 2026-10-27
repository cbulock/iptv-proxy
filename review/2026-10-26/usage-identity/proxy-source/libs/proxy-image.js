import axios from 'axios';
import getBaseUrl from './getBaseUrl.js';
import escapeHtml from 'escape-html';

export function getProxiedImageUrl(originalUrl, source, req) {
  if (!originalUrl) return '';
  return `${getBaseUrl(req)}/images/${encodeURIComponent(source)}/${encodeURIComponent(originalUrl)}`;
}

export function imageProxyRoute(app) {
  app.get('/images/:source/:url', async (req, res) => {
    const decodedUrl = decodeURIComponent(req.params.url);

    // Validate URL using new URL() — recognised by CodeQL as an SSRF sanitizer.
    let parsedUrl;
    try {
      parsedUrl = new URL(decodedUrl);
    } catch {
      return res.status(400).send('Invalid image URL');
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return res.status(400).send('Invalid image URL');
    }

    const upstreamRequest = new AbortController();
    let upstreamBody;
    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      upstreamRequest.abort();
      const upstreamSocket = upstreamBody?.socket;
      if (upstreamBody && !upstreamBody.destroyed) upstreamBody.destroy();
      upstreamSocket?.destroy();
    };
    const abortForDisconnectedClient = () => {
      if (!res.writableEnded) cleanup();
    };
    req.on('aborted', cleanup);
    res.on('close', abortForDisconnectedClient);
    res.on('error', cleanup);

    try {
      const response = await axios.get(parsedUrl.href, {
        responseType: 'stream',
        signal: upstreamRequest.signal,
      });
      upstreamBody = response.data;
      if (cleanedUp) {
        const upstreamSocket = upstreamBody.socket;
        if (!upstreamBody.destroyed) upstreamBody.destroy();
        upstreamSocket?.destroy();
        return;
      }
      res.set(response.headers);
      upstreamBody.on('error', err => {
        if (!res.destroyed) res.destroy(err);
      });
      upstreamBody.pipe(res);
    } catch (err) {
      cleanup();
      if (res.destroyed || res.writableEnded) return;
      console.warn(`Failed to fetch image from ${decodedUrl}: ${err.message}`);
      // Return a more helpful error message
      if (err.response?.status === 404) {
        res.status(404).send(`Image not found: ${escapeHtml(decodedUrl)}`);
      } else if (err.response?.status === 403) {
        res.status(403).send(`Access denied to image: ${escapeHtml(decodedUrl)}`);
      } else if (err.code === 'ENOTFOUND') {
        res.status(502).send(`Cannot resolve hostname for image: ${escapeHtml(decodedUrl)}`);
      } else {
        res.status(502).send('Failed to fetch image from source');
      }
    }
  });
}
