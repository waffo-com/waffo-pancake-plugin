import { logger } from "../utils/logger";

const RELAY_BASE_URL = "https://relay.waffo.ai";

export interface RelayClient {
  register: (targetUrl: string) => Promise<boolean>;
  getWebhookUrl: () => string;
  getPluginId: () => string;
}

/**
 * Create a relay client that registers the current tunnel URL
 * with the Waffo Webhook Relay service.
 *
 * The relay provides a permanent URL: relay.waffo.ai/webhook/{pluginId}
 * that forwards to whatever tunnel URL is currently active.
 */
export function createRelayClient(pluginId: string): RelayClient {
  const webhookUrl = `${RELAY_BASE_URL}/webhook/${pluginId}`;

  return {
    async register(targetUrl: string): Promise<boolean> {
      logger.info(`Registering with relay: ${pluginId} → ${targetUrl}`);

      try {
        const response = await fetch(`${RELAY_BASE_URL}/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pluginId, targetUrl }),
        });

        if (!response.ok) {
          logger.error(`Relay registration failed: ${response.status} ${response.statusText}`);
          return false;
        }

        logger.info(`Relay registered — permanent URL: ${webhookUrl}`);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Relay registration error: ${message}`);
        return false;
      }
    },

    getWebhookUrl() {
      return webhookUrl;
    },

    getPluginId() {
      return pluginId;
    },
  };
}
