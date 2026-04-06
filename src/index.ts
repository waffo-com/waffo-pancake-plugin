import { join } from "node:path";
import { homedir } from "node:os";
import { createWebhookHandler } from "./routes/webhook";
import { createQueryEventsTool } from "./tools/query-events";
import { createQueryStatusTool } from "./tools/query-status";
import { createRetryEventTool } from "./tools/retry-event";
import { createJsonStore } from "./store/json-store";
import { createTunnelManager } from "./tunnel/cloudflare";
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

    // HTTP Route: receive Pancake webhooks
    const handleWebhook = createWebhookHandler(api, store);
    api.registerHttpRoute({
      path: "/pancake/webhook",
      auth: "plugin",
      match: "exact",
      handler: (req: any, res: any) => handleWebhook(req, res),
    });

    // Tools: agent-callable
    api.registerTool(createQueryEventsTool(store));
    api.registerTool(createQueryStatusTool(store));
    api.registerTool(createRetryEventTool(api, store));

    // Tunnel: auto-start Cloudflare Tunnel for local deployments
    const tunnelManager = createTunnelManager(config.tunnel);
    tunnelManager.start().then((url) => {
      if (url) {
        const webhookUrl = `${url}/pancake/webhook`;
        logger.info("=".repeat(60));
        logger.info("Pancake plugin ready!");
        logger.info(`Webhook URL: ${webhookUrl}`);
        logger.info("Copy this URL to Pancake Dashboard → Settings → Webhooks");
        logger.info("=".repeat(60));
      } else {
        logger.info("Pancake plugin registered — webhook at /pancake/webhook");
        logger.info("Tunnel disabled — ensure OpenClaw is publicly accessible");
      }
    }).catch((err) => {
      logger.warn(`Tunnel failed to start: ${err}`);
      logger.info("Pancake plugin registered — webhook at /pancake/webhook");
      logger.info("Please set up a public URL manually (cloudflared/ngrok/etc)");
    });

    // Cleanup tunnel on process exit
    process.on("beforeExit", () => tunnelManager.stop());
    process.on("SIGINT", () => { tunnelManager.stop(); process.exit(0); });
    process.on("SIGTERM", () => { tunnelManager.stop(); process.exit(0); });
  },
};
