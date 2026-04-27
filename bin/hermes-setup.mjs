#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { execSync, spawn } from "node:child_process";

const HERMES_DIR = join(homedir(), ".hermes");
const CONFIG_FILE = join(HERMES_DIR, "config.yaml");
const HERMES_BIN = join(HERMES_DIR, "hermes-agent", "venv", "bin", "hermes");
const HERMES_SRC = join(HERMES_DIR, "hermes-agent");
const STATE_FILE = join(HERMES_DIR, "pancake-hermes-state.json");
const TUNNEL_LOG = join(HERMES_DIR, "pancake-tunnel.log");
const RELAY_BASE = "https://relay.waffo.ai";

/** Find cloudflared binary (tries common install paths + cached npm binary) */
function findCloudflaredBin() {
  const candidates = [
    "/opt/homebrew/bin/cloudflared",
    "/usr/local/bin/cloudflared",
    join(homedir(), ".openclaw/extensions/pancake/node_modules/cloudflared/bin/cloudflared"),
    join(homedir(), ".hermes/pancake-cloudflared/node_modules/cloudflared/bin/cloudflared"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

const SUPPORTED_PLATFORMS = [
  "feishu", "telegram", "slack", "discord", "wecom", "dingtalk",
  "whatsapp", "matrix", "mattermost", "signal", "email", "sms",
];

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

// --url flag: show current webhook URL
if (process.argv.includes("--url")) {
  const url = getWebhookUrl();
  if (url) {
    console.log(url);
  } else {
    console.log("No Pancake × Hermes configuration found. Run hermes-setup to finish setup.");
    process.exit(1);
  }
  process.exit(0);
}

// --stop flag: kill tunnel process
if (process.argv.includes("--stop")) {
  const state = loadState();
  if (state.tunnelPid) {
    try {
      process.kill(state.tunnelPid);
      console.log(`✅ Tunnel stopped (PID: ${state.tunnelPid})`);
      delete state.tunnelPid;
      saveState(state);
    } catch (err) {
      console.log(`⚠️  Couldn't stop PID ${state.tunnelPid}: ${err.message}`);
    }
  } else {
    console.log("No tunnel is currently tracked.");
  }
  process.exit(0);
}

// Parse CLI args: --platform, --chat-id for non-interactive mode
function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx > 0 && idx < process.argv.length - 1 ? process.argv[idx + 1] : null;
}

async function main() {
  console.log("\n🥞 Pancake × Hermes · Setup\n");

  // 1. Check Hermes installed
  if (!existsSync(HERMES_BIN)) {
    console.log("❌ Hermes installation not found at ~/.hermes/hermes-agent/");
    console.log("   Install Hermes first: https://github.com/NousResearch/hermes-agent");
    process.exit(1);
  }

  // 2. Check Hermes version supports feishu delivery (commit 6d5f607e, 2026-04-10)
  try {
    const hasFeishu = execSync(
      `cd "${HERMES_SRC}" && grep -q "\\"feishu\\"" gateway/platforms/webhook.py && echo yes || echo no`,
      { encoding: "utf8" },
    ).trim();
    if (hasFeishu !== "yes") {
      console.log("⚠️  Your Hermes build predates multi-platform webhook delivery.");
      const upgrade = await ask("Upgrade Hermes to the latest version? [Y/n]: ");
      if (upgrade.toLowerCase() !== "n") {
        console.log("📦 Upgrading Hermes…");
        execSync(`cd "${HERMES_SRC}" && git stash && git pull origin main`, { stdio: "inherit" });
        console.log("✅ Hermes upgraded.\n");
      } else {
        console.log("Aborted. Hermes builds from 2026-04-10 or later are required.");
        process.exit(1);
      }
    }
  } catch (err) {
    console.log(`⚠️  Couldn't verify Hermes version: ${err.message}`);
  }

  // 3. Enable webhook platform in config.yaml
  ensureWebhookPlatform();

  // 4. Choose platform (CLI arg or prompt)
  let platform = getArg("--platform");
  if (!platform) {
    console.log("📬 Choose a delivery channel:\n");
    SUPPORTED_PLATFORMS.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p}`);
    });
    const platformChoice = await ask(`\nEnter a number (1–${SUPPORTED_PLATFORMS.length}): `);
    const pIndex = parseInt(platformChoice, 10) - 1;
    if (isNaN(pIndex) || pIndex < 0 || pIndex >= SUPPORTED_PLATFORMS.length) {
      console.log("❌ Invalid selection.");
      process.exit(1);
    }
    platform = SUPPORTED_PLATFORMS[pIndex];
  }
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    console.log(`❌ Unsupported platform: ${platform}`);
    console.log(`   Available: ${SUPPORTED_PLATFORMS.join(", ")}`);
    process.exit(1);
  }
  console.log(`\n✅ Selected: ${platform}\n`);

  // 5. Get chat_id (CLI arg or prompt)
  let chatId = getArg("--chat-id");
  if (!chatId) {
    const chatIdHint = platform === "feishu"
      ? "(Lark / Feishu: oc_xxx group ID or user open_id)"
      : platform === "telegram"
      ? "(Telegram: numeric chat_id)"
      : platform === "slack"
      ? "(Slack: C0xxxxx channel ID)"
      : "";
    chatId = (await ask(`Target chat_id ${chatIdHint}: `)).trim();
  }
  if (!chatId) {
    console.log("❌ chat_id cannot be empty.");
    process.exit(1);
  }

  // 6. Subscribe webhook route
  console.log("\n📝 Subscribing the pancake webhook route…");
  const prompt = `Pancake payment event for an indie maker.

Event: {eventType}
Product: {data.productName}
Amount: {data.amount} {data.currency}
Buyer: {data.buyerEmail}
Time: {timestamp}
Event ID: {eventId}

Respond in Feishu-friendly Markdown. Match the product's language (Chinese product name → Chinese labels; English → English labels).

Exact 10-line structure:

Line 1: "# " + event emoji(s) + " " + punchy event title (≤ 10 chars)
  · order.completed → "新订单入账" / "New sale"
  · subscription.activated → "新订阅到手" / "New subscription"
  · subscription.payment_succeeded → "续费成功" / "Renewed"
  · subscription.canceling / canceled → "有人要走了" / "Cancellation"
  · refund.succeeded → "退款完成" / "Refunded"
  · refund.failed / past_due → "扣款异常" / "Payment issue"
Line 2: (blank)
Line 3: "商品名称：" (or "Product: ") + **bold product name**
Line 4: "金额：" (or "Amount: ") + amount + " " + currency
Line 5: "用户邮箱：" (or "Buyer: ") + buyer email
Line 6: (blank)
Line 7: one fun, product-aware line. AVOID generic cheers ("加油", "值得", "太棒了", "nice work", "keep it up"). PREFER in priority order:
  1. BEST — infer what the product does and weave that into the line:
     · "人生管理模板" → "又一个人选择用你的模板管理人生"
     · "AI 对话助手" → "又有人让你的 AI 替他加班"
     · "code editor" → "someone just trusted your editor to ship their side project"
  2. If product use is unclear, fall back to tangible life scenes — "这单够你今晚点个烧烤了", "又凑够一个月云服务器钱"
  3. Playful observations — "又一个陌生人为你的代码付费", "someone just voted with their wallet"
  4. Gentle humor on churn / refund — "天要下雨，用户要取消", "退就退吧，钱来过见过"
  Match the event mood: celebratory for sales, affectionate for renewals, composed for cancellations, matter-of-fact for refunds.
Line 8: ---
Line 9: "订单号：" (or "Order ID: ") + \`event_id\` in inline backticks
Line 10: "时间：" (or "Time: ") + time

Event emoji: 💰🎉 order.completed · ✨ subscription.activated · 🔁 subscription.payment_succeeded · 👋 subscription.canceling/canceled · 💸 refund.succeeded · ⚠️ refund.failed/past_due

Emit only those ten lines. No preamble or trailer.`;

  try {
    // Remove existing subscription if any
    try {
      execSync(`"${HERMES_BIN}" webhook remove pancake`, { stdio: "pipe" });
    } catch {
      // Ignore if doesn't exist
    }

    execSync(
      `"${HERMES_BIN}" webhook subscribe pancake ` +
      `--prompt ${JSON.stringify(prompt)} ` +
      `--deliver ${platform} ` +
      `--deliver-chat-id ${chatId} ` +
      `--secret INSECURE_NO_AUTH ` +
      `--description "Pancake payment webhooks"`,
      { stdio: "pipe" },
    );
    console.log("✅ Webhook route subscribed.\n");
  } catch (err) {
    console.log(`❌ Subscription failed: ${err.message}`);
    process.exit(1);
  }

  // 7. Generate pluginId and save state
  const state = loadState();
  if (!state.pluginId) state.pluginId = randomUUID();
  state.platform = platform;
  state.chatId = chatId;
  saveState(state);

  // 8. Auto-start Cloudflare Tunnel + register with Relay
  const tunnelUrl = await startTunnel();
  if (!tunnelUrl) {
    console.log("❌ Tunnel failed to start. Run manually: cloudflared tunnel --url http://localhost:8644");
    process.exit(1);
  }

  console.log(`✅ Tunnel up: ${tunnelUrl}\n`);

  // 9. Register with Waffo Relay
  console.log("🔗 Registering with Waffo Relay…");
  const registered = await registerWithRelay(state.pluginId, `${tunnelUrl}/webhooks/pancake`);
  if (!registered) {
    console.log("❌ Relay registration failed.");
    process.exit(1);
  }

  const webhookUrl = `${RELAY_BASE}/webhook/${state.pluginId}`;
  console.log("✅ Relay registered.\n");

  // 10. Restart Hermes gateway
  console.log("🔄 Restarting Hermes gateway…");
  let gatewayRestarted = false;
  for (const cmd of [
    `"${HERMES_BIN}" gateway restart`,
    `"${HERMES_BIN}" gateway stop; sleep 2; "${HERMES_BIN}" gateway start`,
  ]) {
    try {
      execSync(cmd, { stdio: "pipe", timeout: 30000, shell: true });
      gatewayRestarted = true;
      console.log("✅ Gateway restarted.\n");
      break;
    } catch {
      // try next method
    }
  }

  // 11. Done
  console.log("=".repeat(60));
  console.log("🎉 All set.\n");
  console.log("📋 Your permanent Webhook URL — paste into the Pancake Dashboard:\n");
  console.log(`   ${webhookUrl}\n`);
  if (!gatewayRestarted) {
    console.log("⚠️  Automatic gateway restart failed. Run this to apply the config:\n");
    console.log("   hermes gateway stop && hermes gateway start\n");
  }
  console.log("Next steps:");
  if (!gatewayRestarted) {
    console.log("  1. Run the command above to restart the gateway");
    console.log("  2. Open Pancake Dashboard → Settings → Webhooks");
    console.log("  3. Paste the URL above, select events, save");
  } else {
    console.log("  1. Open Pancake Dashboard → Settings → Webhooks");
    console.log("  2. Paste the URL above, select events, save");
  }
  console.log("");
  console.log("Show URL anytime:  hermes-setup --url");
  console.log("Stop the tunnel:   hermes-setup --stop");
  console.log("=".repeat(60) + "\n");

  rl.close();
}

/** Kill existing tunnel if recorded */
function killExistingTunnel() {
  const state = loadState();
  if (state.tunnelPid) {
    try {
      process.kill(state.tunnelPid, 0); // check if alive
      process.kill(state.tunnelPid);
      console.log(`🛑 Stopped previous tunnel (PID: ${state.tunnelPid})`);
    } catch {
      // not running, stale PID
    }
    delete state.tunnelPid;
    saveState(state);
  }
}

/** Start Cloudflare Tunnel in background, wait for URL */
async function startTunnel() {
  killExistingTunnel();

  let cfBin = findCloudflaredBin();
  if (!cfBin) {
    console.log("📥 cloudflared not found — installing…");
    try {
      execSync(
        `mkdir -p ${HERMES_DIR}/pancake-cloudflared && cd ${HERMES_DIR}/pancake-cloudflared && npm init -y > /dev/null && npm install cloudflared --silent`,
        { stdio: "pipe", timeout: 120000 },
      );
      cfBin = findCloudflaredBin();
      if (!cfBin) throw new Error("install failed");
      console.log("✅ cloudflared installed.\n");
    } catch (err) {
      console.log(`❌ cloudflared install failed: ${err.message}`);
      return null;
    }
  }

  console.log("🚇 Starting Cloudflare Tunnel…");

  // Clear old log
  try { writeFileSync(TUNNEL_LOG, ""); } catch {}

  // Spawn cloudflared detached - survives after setup exits
  const child = spawn(cfBin, ["tunnel", "--url", "http://localhost:8644"], {
    detached: true,
    stdio: ["ignore", "inherit", "pipe"],
  });

  // Redirect stderr (cloudflared logs) to log file
  const fs = await import("node:fs");
  const logStream = fs.createWriteStream(TUNNEL_LOG, { flags: "w" });
  child.stderr.pipe(logStream);

  child.unref();

  // Wait up to 30s for tunnel URL to appear in log
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const log = readFileSync(TUNNEL_LOG, "utf8");
      const match = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        const state = loadState();
        state.tunnelPid = child.pid;
        saveState(state);
        return match[0];
      }
    } catch {}
  }

  return null;
}

/** Register tunnel URL with Waffo Relay */
async function registerWithRelay(pluginId, targetUrl) {
  try {
    const response = await fetch(`${RELAY_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pluginId, targetUrl }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function ensureWebhookPlatform() {
  if (!existsSync(CONFIG_FILE)) {
    console.log(`❌ Hermes config not found: ${CONFIG_FILE}`);
    process.exit(1);
  }

  const content = readFileSync(CONFIG_FILE, "utf8");

  // Check if webhook platform already enabled
  if (content.includes("webhook:") && /webhook:\s*\n\s*enabled:\s*true/.test(content)) {
    console.log("✅ Webhook platform already enabled.\n");
    return;
  }

  console.log("📝 Enabling the webhook platform…");
  const webhookConfig = `

platforms:
  webhook:
    enabled: true
    extra:
      host: "0.0.0.0"
      port: 8644
      secret: "INSECURE_NO_AUTH"
`;
  appendFileSync(CONFIG_FILE, webhookConfig);
  console.log("✅ Webhook platform enabled.\n");
}

function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  mkdirSync(HERMES_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function getWebhookUrl() {
  const state = loadState();
  if (!state.pluginId) return null;
  return `${RELAY_BASE}/webhook/${state.pluginId}`;
}

main().catch((err) => {
  console.error("Setup failed:", err.message);
  process.exit(1);
});
