import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJsonStore } from "../../src/store/json-store";
import { normalizeEvent } from "../../src/processors/normalizer";
import { checkIdempotency, markProcessed, resetForTesting } from "../../src/processors/idempotency";
import { buildPrompt } from "../../src/agent/prompt-builder";
import type { PancakeWebhookPayload } from "../../src/types";

function makePayload(): PancakeWebhookPayload {
  return {
    id: "whd_integ_1",
    timestamp: "2026-04-06T14:00:00Z",
    eventType: "order.completed",
    eventId: "PAY_integ_1",
    storeId: "STO_integ",
    mode: "test",
    data: {
      productName: "Design Kit",
      amount: "49.00",
      currency: "USD",
      buyerEmail: "buyer@test.com",
    },
  };
}

describe("Webhook flow integration", () => {
  let tempDir: string;
  let store: ReturnType<typeof createJsonStore>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pancake-integ-"));
    store = createJsonStore(join(tempDir, "state.json"));
    resetForTesting();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("processes a webhook through the full pipeline", async () => {
    const payload = makePayload();

    expect(await checkIdempotency(payload.id)).toBe(false);

    const event = normalizeEvent(payload);
    expect(event.category).toBe("payment");
    expect(event.status).toBe("success");
    expect(event.summary.productName).toBe("Design Kit");

    await store.saveEvent(event);
    await markProcessed(payload.id);
    await store.addProcessedId(payload.id);

    const prompt = buildPrompt(event);
    expect(prompt).toContain("[TEST]");
    expect(prompt).toContain("Design Kit");
    expect(prompt).toContain("49.00 USD");

    const state = await store.loadState();
    expect(state.events).toHaveLength(1);
    expect(state.processedIds).toContain("whd_integ_1");
    expect(state.stats.totalReceived).toBe(1);

    expect(await checkIdempotency(payload.id)).toBe(true);
    expect(await store.hasProcessedId(payload.id)).toBe(true);
  });

  it("updates event status after agent trigger", async () => {
    const payload = makePayload();
    const event = normalizeEvent(payload);
    await store.saveEvent(event);

    await store.updateEventStatus(event.deliveryId, "agent_triggered", {
      agentResult: { success: true, sessionId: "pancake-STO_integ-test" },
    });

    const state = await store.loadState();
    const record = state.events[0];
    expect(record.processingStatus).toBe("agent_triggered");
    expect(record.agentResult?.success).toBe(true);
    expect(state.stats.totalTriggered).toBe(1);
  });
});
