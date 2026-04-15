import type { IncomingMessage, ServerResponse } from "node:http";
import { verifyWebhookSignature } from "../processors/signature";
import { checkIdempotency, markProcessed } from "../processors/idempotency";
import { normalizeEvent } from "../processors/normalizer";
import { triggerAgent, type TriggerOptions } from "../agent/trigger";
import { logger } from "../utils/logger";
import type { PancakeWebhookPayload } from "../types";
import type { JsonStore } from "../store/json-store";

export function createWebhookHandler(
  store: JsonStore,
  triggerOptions: TriggerOptions = {},
) {
  return async function handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");

    let payload: PancakeWebhookPayload;
    try {
      payload = JSON.parse(body);
    } catch {
      logger.warn("Invalid JSON in webhook body");
      res.writeHead(400);
      res.end("Bad Request");
      return;
    }

    // Log headers for debugging signature header name
    const relevantHeaders = Object.entries(req.headers)
      .filter(([k]) => k.startsWith("x-") || k === "content-type" || k.includes("signature"))
      .map(([k, v]) => `${k}: ${v}`);
    logger.info(`Webhook headers: ${relevantHeaders.join(" | ")}`);

    const signatureHeader = req.headers["x-waffo-signature"] as string | undefined;
    if (!verifyWebhookSignature(body, signatureHeader, payload.mode)) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }

    if (await checkIdempotency(payload.id)) {
      logger.info(`Duplicate delivery ignored: ${payload.id}`);
      res.writeHead(200);
      res.end("OK");
      return;
    }

    if (await store.hasProcessedId(payload.id)) {
      logger.info(`Duplicate delivery ignored (persisted): ${payload.id}`);
      await markProcessed(payload.id);
      res.writeHead(200);
      res.end("OK");
      return;
    }

    const event = normalizeEvent(payload);

    await store.saveEvent(event);
    await markProcessed(payload.id);
    await store.addProcessedId(payload.id);

    res.writeHead(200);
    res.end("OK");

    try {
      const result = await triggerAgent(event, triggerOptions);
      await store.updateEventStatus(event.deliveryId, result.success ? "agent_triggered" : "agent_failed", {
        agentResult: result,
      });
    } catch (err) {
      logger.error(`Agent trigger failed for ${event.deliveryId}:`, err);
      await store.updateEventStatus(event.deliveryId, "agent_failed", {
        agentResult: { success: false, error: String(err) },
      });
    }
  };
}
