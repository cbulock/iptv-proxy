import axios from 'axios';
import { loadAppConfigFromStore } from './app-settings-service.js';

/**
 * Send a POST notification to all configured webhook URLs that subscribe to
 * the given event type.
 *
 * Webhooks are configured in the app config under the `webhooks` array:
 *
 *   webhooks:
 *     - url: https://example.com/hook
 *       events:               # optional – omit to receive all events
 *         - channels.refreshed
 *         - epg.refreshed
 *
 * Each webhook receives a JSON body:
 *   { event: "channels.refreshed", timestamp: "...", data: { ... } }
 *
 * Delivery failures are logged but never throw so callers are unaffected.
 *
 * @param {string} event - Event name (e.g. 'channels.refreshed')
 * @param {object} [data={}] - Arbitrary payload attached to the notification
 */
export async function notifyWebhooks(event, data = {}) {
  let appConfig;
  try {
    appConfig = loadAppConfigFromStore();
  } catch {
    return;
  }

  const webhooks = appConfig.webhooks;
  if (!Array.isArray(webhooks) || webhooks.length === 0) return;

  const body = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };

  await Promise.allSettled(
    webhooks
      .filter(hook => {
        if (!hook?.url) return false;
        // If the hook declares an events filter, respect it; otherwise deliver all
        if (Array.isArray(hook.events) && hook.events.length > 0) {
          return hook.events.includes(event);
        }
        return true;
      })
      .map(async hook => {
        try {
          await axios.post(hook.url, body, {
            timeout: hook.timeout_ms ?? 5000,
            headers: { 'Content-Type': 'application/json' },
          });
          console.log(`[Webhooks] Delivered "${event}" to ${hook.url}`);
        } catch (err) {
          console.warn(`[Webhooks] Failed to deliver "${event}" to ${hook.url}: ${err.message}`);
        }
      })
  );
}
