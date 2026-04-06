import { buildPrompt } from "./prompt-builder";
import { logger } from "../utils/logger";
import type { PancakeEvent, AgentResult } from "../types";

export async function triggerAgent(
  api: { runtime: { agent: { runEmbeddedPiAgent: (opts: { sessionId: string; prompt: string }) => Promise<unknown> } } },
  event: PancakeEvent,
): Promise<AgentResult> {
  const prompt = buildPrompt(event);
  const sessionId = `pancake-${event.storeId}-${event.mode}`;

  logger.info(`Triggering agent for ${event.deliveryId} (session: ${sessionId})`);

  try {
    await api.runtime.agent.runEmbeddedPiAgent({ sessionId, prompt });
    logger.info(`Agent triggered successfully for ${event.deliveryId}`);
    return { success: true, sessionId };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error(`Agent trigger failed for ${event.deliveryId}: ${error}`);
    return { success: false, error };
  }
}
