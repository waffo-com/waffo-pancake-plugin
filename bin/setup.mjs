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
const RELAY_BASE = "https://relay.waffo.ai";
const VERSION = "0.4.3";

// --url flag: quick webhook URL lookup
if (process.argv.includes("--url")) {
  const url = getWebhookUrl();
  if (url) {
    console.log(url);
  } else {
    console.log("No Pancake × OpenClaw configuration found. Run openclaw-setup to finish setup.");
    process.exit(1);
  }
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

async function main() {
  console.log("\n🥞 Pancake × OpenClaw · Setup\n");

  // Step 1: Check OpenClaw
  if (!existsSync(CONFIG_FILE)) {
    console.log("❌ OpenClaw config not found (~/.openclaw/openclaw.json)");
    console.log("   Install and start OpenClaw first: https://openclaw.ai");
    process.exit(1);
  }

  // Step 2: Install plugin files
  console.log("📦 Installing plugin…");
  mkdirSync(EXTENSIONS_DIR, { recursive: true });

  try {
    execSync(
      `cd "${EXTENSIONS_DIR}" && npm pack @waffo/pancake-plugin 2>/dev/null && tar xzf *.tgz --strip-components=1 && rm *.tgz && npm install --omit=dev 2>/dev/null`,
      { stdio: "pipe" },
    );
    console.log("✅ Plugin installed.\n");
  } catch {
    console.log("❌ Install failed. Check your network and try again.");
    process.exit(1);
  }

  // Step 3: Scan available agents
  const agents = scanAgents();
  if (agents.length === 0) {
    console.log("⚠️  No agents found. Create one in OpenClaw and connect it to an IM channel first.");
    process.exit(1);
  }

  console.log("🤖 Choose the agent to receive notifications:\n");
  agents.forEach((a, i) => {
    const channel = a.channel ? `[${a.channel}]` : "";
    console.log(`  ${i + 1}. ${a.name || a.id} ${channel}`);
  });

  const choice = await ask(`\nEnter a number (1–${agents.length}): `);
  const index = parseInt(choice, 10) - 1;
  if (isNaN(index) || index < 0 || index >= agents.length) {
    console.log("❌ Invalid selection.");
    process.exit(1);
  }

  const selectedAgent = agents[index];
  console.log(`\n✅ Selected: ${selectedAgent.name || selectedAgent.id}\n`);

  // Step 4: Choose target session/chat
  const sessions = scanSessions(selectedAgent.id);
  let notifyTarget = null;

  if (sessions.length === 0) {
    console.log("⚠️  This agent has no session history yet.");
    const fallback = parseAgentIdForTarget(selectedAgent.id);
    if (fallback) {
      console.log(`   Falling back to delivery target parsed from agentId: ${fallback.channel}/${fallback.to}\n`);
      notifyTarget = fallback;
    } else {
      console.log("❌ Could not determine a notification target. Send the agent at least one message, then re-run setup.");
      process.exit(1);
    }
  } else if (sessions.length === 1) {
    notifyTarget = sessions[0].target;
    console.log(`✅ Using the only session: ${sessions[0].label}\n`);
  } else {
    console.log("💬 Choose a session to receive notifications:\n");
    sessions.forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.label}`);
    });

    const sessionChoice = await ask(`\nEnter a number (1–${sessions.length}): `);
    const sIndex = parseInt(sessionChoice, 10) - 1;
    if (isNaN(sIndex) || sIndex < 0 || sIndex >= sessions.length) {
      console.log("❌ Invalid selection.");
      process.exit(1);
    }
    notifyTarget = sessions[sIndex].target;
    console.log(`\n✅ Selected: ${sessions[sIndex].label}\n`);
  }

  // Step 5: Update openclaw.json
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
      notifyTarget,
    },
  };

  if (!config.plugins.installs) config.plugins.installs = {};
  config.plugins.installs.pancake = {
    source: "npm",
    spec: "@waffo/pancake-plugin",
    installPath: EXTENSIONS_DIR,
    version: VERSION,
  };

  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  console.log("✅ Config saved.\n");

  // Step 6: Generate pluginId and show Webhook URL
  const webhookUrl = ensureWebhookUrl();

  console.log("=".repeat(60));
  console.log("🎉 All set.\n");
  console.log("📋 Your permanent Webhook URL — paste into the Pancake Dashboard:\n");
  console.log(`   ${webhookUrl}\n`);
  console.log("Next steps:");
  console.log("  1. Restart OpenClaw");
  console.log("  2. Open Pancake Dashboard → Settings → Webhooks");
  console.log("  3. Paste the URL above, select events, save");
  console.log("");
  console.log("Show URL anytime:  openclaw-setup --url");
  console.log("=".repeat(60) + "\n");

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

/**
 * Scan an agent's sessions to find available notification targets (p2p and group chats).
 * Returns [{ label, target: { channel, to } }]
 */
function scanSessions(agentId) {
  const sessionsFile = join(OPENCLAW_DIR, "agents", agentId, "sessions", "sessions.json");
  if (!existsSync(sessionsFile)) return [];

  try {
    const sessions = JSON.parse(readFileSync(sessionsFile, "utf8"));
    const targets = [];

    for (const [key, s] of Object.entries(sessions)) {
      const ctx = s.deliveryContext;
      if (!ctx?.channel || !ctx?.to) continue;

      const isGroup = s.chatType === "group" || ctx.to.startsWith("chat:");
      const label = isGroup
        ? `Group — ${s.displayName || ctx.to}`
        : `Direct — ${s.origin?.label || ctx.to.replace(/^user:/, "")}`;

      targets.push({
        label,
        target: { channel: ctx.channel, to: ctx.to },
      });
    }

    return targets;
  } catch {
    return [];
  }
}

/**
 * Legacy fallback: parse agentId like "feishu-ou_xxx" → { channel, to }
 */
function parseAgentIdForTarget(agentId) {
  const dashIndex = agentId.indexOf("-");
  if (dashIndex < 1) return null;
  const channel = agentId.slice(0, dashIndex);
  const to = agentId.slice(dashIndex + 1);
  if (!channel || !to) return null;
  return { channel, to };
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
  console.error("Setup failed:", err.message);
  process.exit(1);
});
