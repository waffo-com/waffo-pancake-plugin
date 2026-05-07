import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
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
const LOCK_FILE = join(homedir(), ".openclaw", "pancake-tunnel.lock");

/**
 * Cross-process lock using PID file.
 * Returns true if this process acquired the lock.
 */
function acquireTunnelLock(): boolean {
  if (existsSync(LOCK_FILE)) {
    try {
      const pid = parseInt(readFileSync(LOCK_FILE, "utf8").trim(), 10);
      // Check if PID is still running
      process.kill(pid, 0);
      // Process is alive — another instance owns the tunnel
      logger.info(`Tunnel already managed by PID ${pid}, skipping`);
      return false;
    } catch {
      // Process not running — stale lock, take over
      logger.info("Removing stale tunnel lock");
    }
  }
  writeFileSync(LOCK_FILE, String(process.pid), "utf8");
  return true;
}

function releaseTunnelLock(): void {
  try {
    if (existsSync(LOCK_FILE)) {
      const pid = parseInt(readFileSync(LOCK_FILE, "utf8").trim(), 10);
      if (pid === process.pid) {
        unlinkSync(LOCK_FILE);
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

export default {
  id: "pancake",
  name: "Pancake Webhook",
  description: "接收 Pancake 支付事件，触发 OpenClaw Agent 自动通知与交付",
  configSchema: pluginConfigSchema,

  register: (api: any) => {
    const config = pluginConfigSchema.parse(api.pluginConfig ?? {});
    const store = createJsonStore(STATE_FILE);

    // Notification delivery via gateway send RPC
    const triggerOptions = {
      agentId: config.agentId,
      notifyTarget: config.notifyTarget,
    };

    // HTTP Route
    const handleWebhook = createWebhookHandler(store, triggerOptions);
    api.registerHttpRoute({
      path: "/pancake/webhook",
      auth: "plugin",
      match: "exact",
      handler: (req: any, res: any) => handleWebhook(req, res),
    });

    // Tools
    api.registerTool(createQueryEventsTool(store));
    api.registerTool(createQueryStatusTool(store));
    api.registerTool(createRetryEventTool(store, triggerOptions));

    // Startup: tunnel → relay (cross-process singleton via lock file)
    if (acquireTunnelLock()) {
      startNetworking(store, config).catch((err) => {
        logger.error("Networking setup failed:", err);
        logger.info("Pancake plugin registered — webhook at /pancake/webhook");
        logger.info("Please set up a public URL manually");
        releaseTunnelLock();
      });

      // Release lock on exit
      process.on("SIGINT", () => { releaseTunnelLock(); process.exit(0); });
      process.on("SIGTERM", () => { releaseTunnelLock(); process.exit(0); });
      process.on("exit", () => releaseTunnelLock());
    }
  },
};

async function startNetworking(
  store: ReturnType<typeof createJsonStore>,
  config: ReturnType<typeof pluginConfigSchema.parse>,
) {
  // 1. Get or create permanent plugin ID
  const pluginId = await store.getOrCreatePluginId();
  const relay = createRelayClient(pluginId);

  // 2. Start tunnel (auto-reconnect + re-register on URL change)
  const tunnelManager = createTunnelManager(config.tunnel, {
    onUrlChange: async (newUrl) => {
      logger.info(`Tunnel URL changed — re-registering with relay: ${newUrl}`);
      await relay.register(`${newUrl}/pancake/webhook`);
    },
  });
  const tunnelUrl = await tunnelManager.start();

  if (!tunnelUrl) {
    // Tunnel disabled — user manages their own public URL
    logger.info("Pancake plugin registered — webhook at /pancake/webhook");
    logger.info(`Relay webhook URL: ${relay.getWebhookUrl()}`);
    logger.info("Tunnel disabled — register your public URL with relay manually");
    return;
  }

  // 3. Register tunnel URL with relay
  const registered = await relay.register(`${tunnelUrl}/pancake/webhook`);

  // 4. Output the permanent webhook URL
  const webhookUrl = relay.getWebhookUrl();
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
