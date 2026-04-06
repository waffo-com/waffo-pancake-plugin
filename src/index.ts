import { join } from "node:path";
import { homedir } from "node:os";
import { createWebhookHandler } from "./routes/webhook";
import { createQueryEventsTool } from "./tools/query-events";
import { createQueryStatusTool } from "./tools/query-status";
import { createRetryEventTool } from "./tools/retry-event";
import { createJsonStore } from "./store/json-store";
import { pluginConfigSchema } from "./config";
import { logger } from "./utils/logger";

const STATE_FILE = join(homedir(), ".openclaw", "pancake-state.json");

export default {
  id: "@waffo/pancake",
  name: "Pancake Webhook",
  description: "接收 Pancake 支付事件，触发 OpenClaw Agent 自动通知与交付",
  configSchema: pluginConfigSchema,

  register: (api: any) => {
    const store = createJsonStore(STATE_FILE);

    const handleWebhook = createWebhookHandler(api, store);
    api.registerHttpRoute({
      path: "/pancake/webhook",
      auth: "plugin",
      match: "exact",
      handler: (req: any, res: any) => handleWebhook(req, res),
    });

    api.registerTool(createQueryEventsTool(store));
    api.registerTool(createQueryStatusTool(store));
    api.registerTool(createRetryEventTool(api, store));

    logger.info("Pancake plugin registered — webhook at /pancake/webhook");
  },
};
