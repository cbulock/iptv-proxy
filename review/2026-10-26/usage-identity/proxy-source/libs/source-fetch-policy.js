import axios from 'axios';

const DEFAULT_SOURCE_FETCH_TIMEOUT_MS = 10000;

/**
 * Return the bounded deadline used for source metadata requests.
 *
 * SOURCE_FETCH_TIMEOUT_MS is intentionally configurable for slower home networks,
 * while malformed values fall back to a safe default.
 * @returns {number}
 */
export function getSourceFetchTimeoutMs() {
  const configured = Number.parseInt(process.env.SOURCE_FETCH_TIMEOUT_MS, 10);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_SOURCE_FETCH_TIMEOUT_MS;
}

/**
 * Fetch source metadata with a deadline that also actively cancels the request.
 * This supports private IP addresses and local hostnames used by home tuners.
 *
 * @param {string} url
 * @param {import('axios').AxiosRequestConfig} [options]
 * @returns {Promise<import('axios').AxiosResponse>}
 */
export async function fetchSourceMetadata(url, options = {}) {
  const timeout = getSourceFetchTimeoutMs();
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), timeout);

  try {
    return await axios.get(url, {
      ...options,
      timeout,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(deadline);
  }
}
