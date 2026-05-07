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
  const prompt = buildHermesPrompt(platform);

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

/**
 * Build the per-event notification prompt for Hermes's LLM-driven webhook delivery.
 * Mirrors src/agent/prompt-builder.ts (OpenClaw path) so both modes emit the same shape.
 *
 * Feishu / Lark → Chinese labels + Beijing time (UTC+8, no suffix).
 * Everything else → English labels + UTC time (with "UTC" suffix).
 */
function buildHermesPrompt(platform) {
  const isFeishu = platform === "feishu" || platform === "lark";
  const lang = isFeishu ? "Chinese" : "English";
  const sep = isFeishu ? "：" : ": ";
  const tax = isFeishu ? "（含税 {taxAmount}）" : " (incl. tax {taxAmount})";
  const ct = isFeishu ? "个人 / 企业" : "Individual / Business";
  const tz = isFeishu
    ? "Beijing time (UTC+8), format YYYY-MM-DD HH:mm, no timezone suffix"
    : "UTC, format YYYY-MM-DD HH:mm UTC";
  const titlesAndFields = isFeishu ? TITLE_FIELD_TABLE_ZH : TITLE_FIELD_TABLE_EN;
  const buttonLabels = isFeishu
    ? '"查看订单" for order/subscription events, "查看退款" for refund events'
    : '"View Order" for order/subscription events, "View Refund" for refund events';
  const dashUrl = "https://pancake.waffo.ai/merchant/dashboard/{storeId}/{resource}";

  return `Pancake payment webhook → ${lang} notification text.

Webhook payload fields available:
- eventType, timestamp (ISO 8601 UTC), storeName, storeId, mode, eventId
- data.{productName, amount, currency, taxAmount, buyerEmail, orderId,
        billingPeriod, currentPeriodEnd, refundAmount, refundReason, failureReason,
        paymentLast4, effectiveEndDate, canceledAt}
- data.billingDetail.{country, isBusiness}
- For canceled subscriptions, "Canceled At" can fall back to currentPeriodEnd
  if canceledAt / effectiveEndDate is absent.

Output ONLY the formatted notification text. No preamble, no JSON, no code fences.

Layout (use real newlines):

  {testPrefix}{title}

  {label1}${sep}{value1}
  {label2}${sep}{value2}
  ... (one per field for this eventType, in the order listed below)

  {buttonLabel}${sep}${dashUrl}

  waffo.ai · {storeName} · {timestamp}

Rules:
1. {testPrefix}: "[TEST] " when mode=test, else "".
2. {title} and field set per eventType:
${titlesAndFields}
3. {buttonLabel}: ${buttonLabels}.
4. {resource}: "payments" for order/subscription events, "refunds" for refund events.
5. Amount format: "{currency} {amount}". If taxAmount is present and not "0"/"0.00", append "${tax}".
6. Customer Type: ${ct} based on data.billingDetail.isBusiness boolean.
7. Missing / null / empty optional fields render as "—" (em dash).
8. {timestamp} formatting: ${tz}.
9. {storeName}: use the value if present; otherwise "—".

Output the message text only.`;
}

const TITLE_FIELD_TABLE_ZH = `   - order.completed → "✅ 支付成功" → 商品 / 金额 / 买家邮箱 / 国家 / 买家类型 / 订单号
   - subscription.activated → "🎉 订阅激活" → 商品 / 金额 / 买家邮箱 / 国家 / 买家类型 / 订阅周期 / 下次扣款 / 订单号
   - subscription.payment_succeeded → "💰 续费成功" → 商品 / 续费金额 / 买家邮箱 / 国家 / 买家类型 / 订阅周期 / 下次扣款 / 订单号
   - subscription.canceling → "⚠️ 取消订阅" → 商品 / 金额 / 买家邮箱 / 国家 / 买家类型 / 订单号 / 实际终止日
   - subscription.uncanceled → "↩️ 撤销取消" → 商品 / 金额 / 买家邮箱 / 国家 / 买家类型 / 订阅周期 / 下次扣款 / 订单号
   - subscription.updated → "🔄 订阅变更" → 新商品 / 新金额 / 买家邮箱 / 国家 / 买家类型 / 订阅周期 / 下次扣款 / 订单号
   - subscription.canceled → "🚫 订阅终止" → 商品 / 金额 / 买家邮箱 / 国家 / 买家类型 / 订单号 / 终止时间
   - subscription.past_due → "❗ 续费失败" → 商品 / 续费金额 / 买家邮箱 / 国家 / 买家类型 / 卡尾号 / 到期日 / 订单号 / 失败原因
   - refund.succeeded → "💸 退款成功" → 商品 / 退款金额 / 买家邮箱 / 国家 / 买家类型 / 订单号 / 退款原因
   - refund.failed → "❗ 退款失败" → 商品 / 退款金额 / 买家邮箱 / 国家 / 买家类型 / 订单号 / 失败原因`;

const TITLE_FIELD_TABLE_EN = `   - order.completed → "✅ Payment Succeeded" → Product / Amount / Customer Email / Country / Customer Type / Order ID
   - subscription.activated → "🎉 Subscription Activated" → Product / Amount / Customer Email / Country / Customer Type / Billing Period / Next Charge / Order ID
   - subscription.payment_succeeded → "💰 Renewal Succeeded" → Product / Renewal Amount / Customer Email / Country / Customer Type / Billing Period / Next Charge / Order ID
   - subscription.canceling → "⚠️ Unsubscribing" → Product / Amount / Customer Email / Country / Customer Type / Order ID / Final Termination Date
   - subscription.uncanceled → "↩️ Cancellation Withdrawn" → Product / Amount / Customer Email / Country / Customer Type / Billing Period / Next Charge / Order ID
   - subscription.updated → "🔄 Subscription Updated" → New Product / New Amount / Customer Email / Country / Customer Type / Billing Period / Next Charge / Order ID
   - subscription.canceled → "🚫 Subscription Canceled" → Product / Amount / Customer Email / Country / Customer Type / Order ID / Canceled At
   - subscription.past_due → "❗ Renewal Failed" → Product / Renewal Amount / Customer Email / Country / Customer Type / Card Last 4 / Period Ends / Order ID / Failure Reason
   - refund.succeeded → "💸 Refund Succeeded" → Product / Refund Amount / Customer Email / Country / Customer Type / Order ID / Refund Reason
   - refund.failed → "❗ Refund Failed" → Product / Refund Amount / Customer Email / Country / Customer Type / Order ID / Failure Reason`;

main().catch((err) => {
  console.error("Setup failed:", err.message);
  process.exit(1);
});
