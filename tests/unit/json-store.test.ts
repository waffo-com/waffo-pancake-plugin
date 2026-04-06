import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJsonStore } from "../../src/store/json-store";
import type { PancakeEvent } from "../../src/types";

function makeEvent(deliveryId: string): PancakeEvent {
  return {
    deliveryId,
    eventId: "PAY_123",
    originalType: "order.completed",
    category: "payment",
    status: "success",
    storeId: "STO_abc",
    mode: "test",
    summary: { productName: "Test", amount: "10", currency: "USD", buyerEmail: "a@b.com" },
    rawData: {},
    timestamp: "2026-04-06T10:00:00Z",
  };
}

describe("JsonStore", () => {
  let tempDir: string;
  let store: ReturnType<typeof createJsonStore>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pancake-test-"));
    store = createJsonStore(join(tempDir, "state.json"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads default state when file does not exist", async () => {
    const state = await store.loadState();
    expect(state.processedIds).toEqual([]);
    expect(state.events).toEqual([]);
    expect(state.stats.totalReceived).toBe(0);
  });

  it("saves and loads state round-trip", async () => {
    const state = await store.loadState();
    state.processedIds.push("whd_1");
    state.stats.totalReceived = 1;
    await store.saveState(state);

    const loaded = await store.loadState();
    expect(loaded.processedIds).toEqual(["whd_1"]);
    expect(loaded.stats.totalReceived).toBe(1);
  });

  it("saveEvent adds record and increments stats", async () => {
    await store.saveEvent(makeEvent("whd_ev1"));
    const state = await store.loadState();
    expect(state.events).toHaveLength(1);
    expect(state.events[0].deliveryId).toBe("whd_ev1");
    expect(state.events[0].processingStatus).toBe("received");
    expect(state.stats.totalReceived).toBe(1);
  });

  it("updateEventStatus updates the correct record", async () => {
    await store.saveEvent(makeEvent("whd_up"));
    await store.updateEventStatus("whd_up", "agent_triggered", {
      agentResult: { success: true, sessionId: "sess_1" },
    });
    const state = await store.loadState();
    expect(state.events[0].processingStatus).toBe("agent_triggered");
    expect(state.stats.totalTriggered).toBe(1);
  });

  it("caps events at 200 entries", async () => {
    for (let i = 0; i < 210; i++) {
      await store.saveEvent(makeEvent(`whd_${i}`));
    }
    const state = await store.loadState();
    expect(state.events.length).toBeLessThanOrEqual(200);
  });
});
