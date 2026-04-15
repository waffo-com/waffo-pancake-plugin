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
const RELAY_BASE = "https://waffo-pancake-webhook-relay.vercel.app";

/** Find cloudflared binary (tries common install paths + cached npm binary) */
function findCloudflaredBin() {
  const candidates = [
    "/opt/homebrew/bin/cloudflared",
    "/usr/local/bin/cloudflared",
    join(homedir(), ".openclaw/extensions/pancake/node_modules/cloudflared/bin/cloudflared"),
    join(homedir(), ".hermes/pancake-cloudflared/bin/cloudflared"),
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
    console.log("未找到 Pancake × Hermes 配置。先运行 pancake-hermes-setup 完成安装。");
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
      console.log(`✅ Tunnel 已停止 (PID: ${state.tunnelPid})`);
      delete state.tunnelPid;
      saveState(state);
    } catch (err) {
      console.log(`⚠️  无法停止 PID ${state.tunnelPid}: ${err.message}`);
    }
  } else {
    console.log("无运行中的 tunnel 记录");
  }
  process.exit(0);
}

async function main() {
  console.log("\n🥞 Pancake × Hermes — 安装向导\n");

  // 1. Check Hermes installed
  if (!existsSync(HERMES_BIN)) {
    console.log("❌ 未找到 Hermes 安装 (~/.hermes/hermes-agent/)");
    console.log("   请先安装 Hermes: https://github.com/NousResearch/hermes-agent");
    process.exit(1);
  }

  // 2. Check Hermes version supports feishu delivery (commit 6d5f607e, 2026-04-10)
  try {
    const hasFeishu = execSync(
      `cd "${HERMES_SRC}" && grep -q "\\"feishu\\"" gateway/platforms/webhook.py && echo yes || echo no`,
      { encoding: "utf8" },
    ).trim();
    if (hasFeishu !== "yes") {
      console.log("⚠️  Hermes 版本过旧，不支持多平台 webhook 投递。");
      const upgrade = await ask("是否自动升级 Hermes 到最新版本？[Y/n]: ");
      if (upgrade.toLowerCase() !== "n") {
        console.log("📦 升级 Hermes...");
        execSync(`cd "${HERMES_SRC}" && git stash && git pull origin main`, { stdio: "inherit" });
        console.log("✅ Hermes 已升级\n");
      } else {
        console.log("取消安装。需要 2026-04-10 之后的 Hermes 版本。");
        process.exit(1);
      }
    }
  } catch (err) {
    console.log(`⚠️  无法检查 Hermes 版本: ${err.message}`);
  }

  // 3. Enable webhook platform in config.yaml
  ensureWebhookPlatform();

  // 4. Let user choose delivery platform
  console.log("📬 选择通知投递渠道：\n");
  SUPPORTED_PLATFORMS.forEach((p, i) => {
    console.log(`  ${i + 1}. ${p}`);
  });

  const platformChoice = await ask(`\n请输入序号 (1-${SUPPORTED_PLATFORMS.length}): `);
  const pIndex = parseInt(platformChoice, 10) - 1;
  if (isNaN(pIndex) || pIndex < 0 || pIndex >= SUPPORTED_PLATFORMS.length) {
    console.log("❌ 无效选择");
    process.exit(1);
  }
  const platform = SUPPORTED_PLATFORMS[pIndex];
  console.log(`\n✅ 已选择: ${platform}\n`);

  // 5. Ask for chat_id
  const chatIdHint = platform === "feishu"
    ? "(飞书: oc_xxx 群聊 ID 或用户 open_id)"
    : platform === "telegram"
    ? "(Telegram: 数字 chat_id)"
    : platform === "slack"
    ? "(Slack: C0xxxxx channel ID)"
    : "";
  const chatId = (await ask(`请输入目标 chat_id ${chatIdHint}: `)).trim();
  if (!chatId) {
    console.log("❌ chat_id 不能为空");
    process.exit(1);
  }

  // 6. Subscribe webhook route
  console.log("\n📝 订阅 pancake webhook 路由...");
  const prompt = `Pancake 支付通知
📦 事件: {eventType}
商品: {data.productName}
金额: {data.amount} {data.currency}
买家: {data.buyerEmail}
时间: {timestamp}
事件ID: {eventId}`;

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
    console.log("✅ Webhook 路由已订阅\n");
  } catch (err) {
    console.log(`❌ 订阅失败: ${err.message}`);
    process.exit(1);
  }

  // 7. Restart Hermes gateway
  console.log("🔄 重启 Hermes gateway...");
  try {
    execSync(`"${HERMES_BIN}" gateway restart`, { stdio: "pipe", timeout: 30000 });
    console.log("✅ Gateway 已重启\n");
  } catch {
    console.log("⚠️  自动重启失败，请手动运行：hermes gateway restart\n");
  }

  // 8. Generate pluginId and save state
  const state = loadState();
  if (!state.pluginId) state.pluginId = randomUUID();
  state.platform = platform;
  state.chatId = chatId;
  saveState(state);

  // 9. Auto-start Cloudflare Tunnel + register with Relay
  const tunnelUrl = await startTunnel();
  if (!tunnelUrl) {
    console.log("❌ Tunnel 启动失败，请手动运行：cloudflared tunnel --url http://localhost:8644");
    process.exit(1);
  }

  console.log(`✅ Tunnel 已启动: ${tunnelUrl}\n`);

  // 10. Register with Waffo Relay
  console.log("🔗 注册到 Waffo Relay...");
  const registered = await registerWithRelay(state.pluginId, `${tunnelUrl}/webhooks/pancake`);
  if (!registered) {
    console.log("❌ Relay 注册失败");
    process.exit(1);
  }

  const webhookUrl = `${RELAY_BASE}/webhook/${state.pluginId}`;
  console.log("✅ Relay 已注册\n");

  // 11. Done
  console.log("=".repeat(60));
  console.log("🎉 安装完成！\n");
  console.log("📋 你的 Webhook URL（永久有效）:\n");
  console.log(`   ${webhookUrl}\n`);
  console.log("下一步：");
  console.log("  1. 打开 Pancake Dashboard → Settings → Webhooks");
  console.log("  2. 粘贴上面的 URL，勾选事件，保存\n");
  console.log("Tunnel 已在后台运行（PID: " + state.tunnelPid + "）");
  console.log("随时查看 URL：pancake-hermes-setup --url");
  console.log("停止 Tunnel：pancake-hermes-setup --stop");
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
      console.log(`🛑 已停止旧 tunnel (PID: ${state.tunnelPid})`);
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
    console.log("📥 未找到 cloudflared，正在安装...");
    try {
      execSync(
        `mkdir -p ${HERMES_DIR}/pancake-cloudflared && cd ${HERMES_DIR}/pancake-cloudflared && npm init -y > /dev/null && npm install cloudflared --silent`,
        { stdio: "pipe", timeout: 120000 },
      );
      cfBin = findCloudflaredBin();
      if (!cfBin) throw new Error("install failed");
      console.log("✅ cloudflared 已安装\n");
    } catch (err) {
      console.log(`❌ cloudflared 安装失败: ${err.message}`);
      return null;
    }
  }

  console.log("🚇 启动 Cloudflare Tunnel...");

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
    console.log(`❌ 未找到 Hermes 配置: ${CONFIG_FILE}`);
    process.exit(1);
  }

  const content = readFileSync(CONFIG_FILE, "utf8");

  // Check if webhook platform already enabled
  if (content.includes("webhook:") && /webhook:\s*\n\s*enabled:\s*true/.test(content)) {
    console.log("✅ Webhook platform 已启用\n");
    return;
  }

  console.log("📝 启用 Webhook platform...");
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
  console.log("✅ Webhook platform 已启用\n");
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
  console.error("安装出错:", err.message);
  process.exit(1);
});
