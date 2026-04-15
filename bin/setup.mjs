#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { execSync } from "node:child_process";

const OPENCLAW_DIR = join(homedir(), ".openclaw");
const CONFIG_FILE = join(OPENCLAW_DIR, "openclaw.json");
const STATE_FILE = join(OPENCLAW_DIR, "pancake-state.json");
const EXTENSIONS_DIR = join(OPENCLAW_DIR, "extensions", "pancake");
const RELAY_BASE = "https://waffo-pancake-webhook-relay.vercel.app";
const VERSION = "0.3.0";

// --url flag: quick webhook URL lookup
if (process.argv.includes("--url")) {
  const url = getWebhookUrl();
  if (url) {
    console.log(url);
  } else {
    console.log("Pancake 插件未安装或未运行过。请先运行 pancake-setup 安装。");
    process.exit(1);
  }
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

async function main() {
  console.log("\n🥞 Pancake OpenClaw Plugin — 安装向导\n");

  // Step 1: Check OpenClaw
  if (!existsSync(CONFIG_FILE)) {
    console.log("❌ 未找到 OpenClaw 配置文件 (~/.openclaw/openclaw.json)");
    console.log("   请先安装并运行 OpenClaw: https://openclaw.ai");
    process.exit(1);
  }

  // Step 2: Install plugin files
  console.log("📦 安装插件...");
  mkdirSync(EXTENSIONS_DIR, { recursive: true });

  try {
    execSync(
      `cd "${EXTENSIONS_DIR}" && npm pack @waffo-pancake/openclaw-plugin 2>/dev/null && tar xzf *.tgz --strip-components=1 && rm *.tgz && npm install --omit=dev 2>/dev/null`,
      { stdio: "pipe" },
    );
    console.log("✅ 插件安装完成\n");
  } catch {
    console.log("❌ 安装失败，请检查网络连接后重试");
    process.exit(1);
  }

  // Step 3: Scan available agents
  const agents = scanAgents();
  if (agents.length === 0) {
    console.log("⚠️  未找到任何 Agent，请先在 OpenClaw 中创建并绑定 IM 渠道");
    process.exit(1);
  }

  console.log("🤖 选择通知目标 Agent:\n");
  agents.forEach((a, i) => {
    const channel = a.channel ? `[${a.channel}]` : "";
    console.log(`  ${i + 1}. ${a.name || a.id} ${channel}`);
  });

  const choice = await ask(`\n请输入序号 (1-${agents.length}): `);
  const index = parseInt(choice, 10) - 1;
  if (isNaN(index) || index < 0 || index >= agents.length) {
    console.log("❌ 无效选择");
    process.exit(1);
  }

  const selectedAgent = agents[index];
  console.log(`\n✅ 已选择: ${selectedAgent.name || selectedAgent.id}\n`);

  // Step 4: Update openclaw.json
  const config = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));

  if (!config.plugins) config.plugins = {};
  if (!config.plugins.allow) config.plugins.allow = [];
  if (!config.plugins.allow.includes("pancake")) {
    config.plugins.allow.push("pancake");
  }

  if (!config.plugins.entries) config.plugins.entries = {};
  config.plugins.entries.pancake = {
    enabled: true,
    config: {
      agentId: selectedAgent.id,
    },
  };

  if (!config.plugins.installs) config.plugins.installs = {};
  config.plugins.installs.pancake = {
    source: "npm",
    spec: "@waffo-pancake/openclaw-plugin",
    installPath: EXTENSIONS_DIR,
    version: VERSION,
  };

  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  console.log("✅ 配置已写入\n");

  // Step 6: Generate pluginId and show Webhook URL
  const webhookUrl = ensureWebhookUrl();

  console.log("=".repeat(55));
  console.log("🎉 安装完成！\n");
  console.log("📋 你的 Webhook URL（永久有效，复制到 Pancake Dashboard）:\n");
  console.log(`   ${webhookUrl}`);
  console.log("");
  console.log("下一步：");
  console.log("  1. 重启 OpenClaw");
  console.log("  2. 打开 Pancake Dashboard → Settings → Webhooks");
  console.log("  3. 粘贴上面的 URL，勾选事件，保存");
  console.log("");
  console.log("随时查看 URL：pancake-setup --url");
  console.log("=".repeat(55) + "\n");

  rl.close();
}

/** Get or create pluginId, return the permanent webhook URL */
function ensureWebhookUrl() {
  let state = {
    processedIds: [],
    pluginId: null,
    events: [],
    stats: { totalReceived: 0, totalTriggered: 0, totalFailed: 0, lastEventAt: null },
  };

  if (existsSync(STATE_FILE)) {
    try {
      state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    } catch {
      // corrupt file, reset
    }
  }

  if (!state.pluginId) {
    state.pluginId = randomUUID();
    mkdirSync(OPENCLAW_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }

  return `${RELAY_BASE}/webhook/${state.pluginId}`;
}

/** Quick lookup for --url flag */
function getWebhookUrl() {
  if (!existsSync(STATE_FILE)) return null;
  try {
    const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    if (!state.pluginId) return null;
    return `${RELAY_BASE}/webhook/${state.pluginId}`;
  } catch {
    return null;
  }
}

function scanAgents() {
  if (!existsSync(OPENCLAW_DIR)) return [];

  const entries = readdirSync(OPENCLAW_DIR, { withFileTypes: true });
  const agents = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("workspace-")) continue;

    const id = entry.name.replace("workspace-", "");
    if (!id || id.includes(" ")) continue; // skip compound IDs

    // Parse channel from agentId
    const dashIndex = id.indexOf("-");
    const channel = dashIndex > 0 ? id.slice(0, dashIndex) : null;

    // Read agent name from IDENTITY.md
    let name = "";
    const identityPath = join(OPENCLAW_DIR, entry.name, "IDENTITY.md");
    if (existsSync(identityPath)) {
      const content = readFileSync(identityPath, "utf8");
      const match = content.match(/\*\*Name:\*\*\s*(.+)/);
      if (match) name = match[1].trim();
    }

    agents.push({ id, name, channel });
  }

  return agents;
}

main().catch((err) => {
  console.error("安装出错:", err.message);
  process.exit(1);
});
