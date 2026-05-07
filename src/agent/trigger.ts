import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { buildPrompt } from "./prompt-builder";
import { logger } from "../utils/logger";
import type { PancakeEvent, AgentResult } from "../types";

const execAsync = promisify(exec);

/** Resolve openclaw binary path at module load time */
const OPENCLAW_BIN = [
  "/opt/homebrew/bin/openclaw",
  "/usr/local/bin/openclaw",
].find((p) => existsSync(p)) ?? "openclaw";

export interface TriggerOptions {
  agentId?: string;
  notifyTarget?: { channel: string; to: string };
}

/**
 * Parse agentId to extract channel and delivery target (legacy fallback).
 * e.g. "feishu-ou_55a5fed66adc..." → { channel: "feishu", to: "ou_55a5fed66adc..." }
 */
function parseDeliveryTarget(agentId: string): { channel: string; to: string } | null {
  const dashIndex = agentId.indexOf("-");
  if (dashIndex < 1) return null;
  const channel = agentId.slice(0, dashIndex);
  const to = agentId.slice(dashIndex + 1);
  if (!channel || !to) return null;
  return { channel, to };
}

export async function triggerAgent(
  event: PancakeEvent,
  options: TriggerOptions = {},
): Promise<AgentResult> {
  const { agentId, notifyTarget } = options;

  // Resolve delivery target: prefer explicit notifyTarget, fall back to parsing agentId
  const delivery = notifyTarget ?? (agentId ? parseDeliveryTarget(agentId) : null);
  if (!delivery) {
    logger.error(`No delivery target configured (set notifyTarget or use agentId format "{channel}-{to}")`);
    return { success: false, error: "no delivery target configured" };
  }

  const message = buildPrompt(event, { channel: delivery.channel });
  const idempotencyKey = `pancake-${event.deliveryId}`;
  const params = JSON.stringify({
    to: delivery.to,
    message,
    channel: delivery.channel,
    idempotencyKey,
  });

  logger.info(`Sending notification for ${event.deliveryId} via ${delivery.channel} to ${delivery.to}`);

  try {
    const cmd = `${OPENCLAW_BIN} gateway call send --json --params '${params.replace(/'/g, "'\\''")}'`;
    logger.info(`Exec: ${OPENCLAW_BIN} gateway call send`);
    const { stdout, stderr } = await execAsync(cmd, { timeout: 30_000 });
    if (stderr) logger.warn(`Send stderr: ${stderr.slice(0, 200)}`);

    let result: { messageId?: string; chatId?: string } | undefined;
    try {
      result = JSON.parse(stdout.trim());
    } catch {
      // stdout might have config warnings before JSON
      const jsonMatch = stdout.match(/\{[^{}]*"messageId"[^{}]*\}/);
      if (jsonMatch) result = JSON.parse(jsonMatch[0]);
    }

    logger.info(`Notification sent for ${event.deliveryId} (messageId: ${result?.messageId})`);
    return { success: true, sessionId: result?.chatId };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error(`Notification failed for ${event.deliveryId}: ${error}`);
    return { success: false, error };
  }
}
