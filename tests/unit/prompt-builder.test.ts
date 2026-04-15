import { describe, it, expect } from "vitest";
import { buildPrompt } from "../../src/agent/prompt-builder";
import type { PancakeEvent } from "../../src/types";

function makeEvent(overrides: Partial<PancakeEvent> = {}): PancakeEvent {
  return {
    deliveryId: "whd_p1",
    eventId: "PAY_p1",
    originalType: "order.completed",
    category: "payment",
    status: "success",
    storeId: "STO_s1",
    mode: "prod",
    summary: {
      productName: "Notion Template Pro",
      amount: "29.00",
      currency: "USD",
      buyerEmail: "alice@example.com",
    },
    rawData: {},
    timestamp: "2026-04-06T14:32:00Z",
    ...overrides,
  };
}

describe("buildPrompt", () => {
  it("includes event label, amount, product, and email", () => {
    const prompt = buildPrompt(makeEvent());
    expect(prompt).toContain("订单完成");
    expect(prompt).toContain("Notion Template Pro");
    expect(prompt).toContain("29.00 USD");
    expect(prompt).toContain("alice@example.com");
  });

  it("prefixes [TEST] for test mode events", () => {
    const prompt = buildPrompt(makeEvent({ mode: "test" }));
    expect(prompt).toContain("[TEST]");
  });

  it("does not prefix [TEST] for prod mode events", () => {
    const prompt = buildPrompt(makeEvent({ mode: "prod" }));
    expect(prompt).not.toContain("[TEST]");
  });

  it("includes the event ID", () => {
    const prompt = buildPrompt(makeEvent());
    expect(prompt).toContain("PAY_p1");
  });

  it("handles subscription.past_due event", () => {
    const prompt = buildPrompt(makeEvent({
      originalType: "subscription.past_due",
      category: "subscription",
      status: "failed",
    }));
    expect(prompt).toContain("订阅欠费");
  });

  it("includes short emails as-is", () => {
    const prompt = buildPrompt(makeEvent({
      summary: { ...makeEvent().summary, buyerEmail: "ab@test.com" },
    }));
    expect(prompt).toContain("ab@test.com");
  });
});
