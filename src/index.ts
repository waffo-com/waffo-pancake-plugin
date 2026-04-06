import { join } from "node:path";
import { homedir } from "node:os";
import { createWebhookHandler } from "./routes/webhook";
import { createQueryEventsTool } from "./tools/query-events";
import { createQueryStatusTool } from "./tools/query-status";
import { createRetryEventTool } from "./tools/retry-event";
import { createJsonStore } from "./store/json-store";
import { createTunnelManager } from "./tunnel/cloudflare";
import { createRelayClient } from "./relay/client";
import { pluginConfigSchema } from "./config";
import { logger } from "./utils/logger";

const STATE_FILE = join(homedir(), ".openclaw", "pancake-state.json");

export default {
  id: "@waffo/pancake",
  name: "Pancake Webhook",
  description: "接收 Pancake 支付事件，触发 OpenClaw Agent 自动通知与交付",
  configSchema: pluginConfigSchema,

  register: (api: any) => {
    const config = pluginConfigSchema.parse(api.pluginConfig ?? {});
    const store = createJsonStore(STATE_FILE);

    // HTTP Route
    const handleWebhook = createWebhookHandler(api, store);
    api.registerHttpRoute({
      path: "/pancake/webhook",
      auth: "plugin",
      match: "exact",
      handler: (req: any, res: any) => handleWebhook(req, res),
    });

    // Tools
    api.registerTool(createQueryEventsTool(store));
    api.registerTool(createQueryStatusTool(store));
    api.registerTool(createRetryEventTool(api, store));

    // Startup: tunnel → relay → output webhook URL
    startNetworking(store, config).catch((err) => {
      logger.error("Networking setup failed:", err);
      logger.info("Pancake plugin registered — webhook at /pancake/webhook");
      logger.info("Please set up a public URL manually");
    });

    // Cleanup
    process.on("SIGINT", () => process.exit(0));
    process.on("SIGTERM", () => process.exit(0));
  },
};

async function startNetworking(
  store: ReturnType<typeof createJsonStore>,
  config: ReturnType<typeof pluginConfigSchema.parse>,
) {
  // 1. Get or create permanent plugin ID
  const pluginId = await store.getOrCreatePluginId();
  const relay = createRelayClient(pluginId);

  // 2. Start tunnel
  const tunnelManager = createTunnelManager(config.tunnel);
  const tunnelUrl = await tunnelManager.start();

  if (!tunnelUrl) {
    // Tunnel disabled — user manages their own public URL
    logger.info("Pancake plugin registered — webhook at /pancake/webhook");
    logger.info(`Relay webhook URL: ${relay.getWebhookUrl()}/pancake/webhook`);
    logger.info("Tunnel disabled — register your public URL with relay manually");
    return;
  }

  // 3. Register tunnel URL with relay
  const registered = await relay.register(`${tunnelUrl}/pancake/webhook`);

  // 4. Output the permanent webhook URL
  const webhookUrl = `${relay.getWebhookUrl()}/pancake/webhook`;
  logger.info("=".repeat(60));
  logger.info("Pancake plugin ready!");
  if (registered) {
    logger.info(`Webhook URL: ${webhookUrl}`);
    logger.info("This URL is permanent — configure it once in Pancake Dashboard.");
  } else {
    logger.info(`Relay unavailable — use tunnel URL directly: ${tunnelUrl}/pancake/webhook`);
    logger.info("(This URL will change on restart)");
  }
  logger.info("=".repeat(60));

  // Cleanup tunnel on exit
  process.on("beforeExit", () => tunnelManager.stop());
}
