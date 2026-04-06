import { describe, it, expect } from "vitest";
import { normalizeEvent } from "../../src/processors/normalizer";
import type { PancakeWebhookPayload } from "../../src/types";

function makePayload(overrides: Partial<PancakeWebhookPayload> = {}): PancakeWebhookPayload {
  return {
    id: "whd_test123",
    timestamp: "2026-04-06T10:00:00Z",
    eventType: "order.completed",
    eventId: "PAY_abc",
    storeId: "STO_xyz",
    mode: "test",
    data: {
      productName: "Pro Plan",
      amount: "29.00",
      currency: "USD",
      buyerEmail: "alice@example.com",
    },
    ...overrides,
  };
}

describe("normalizeEvent", () => {
  it("normalizes order.completed as payment/success", () => {
    const event = normalizeEvent(makePayload());
    expect(event.deliveryId).toBe("whd_test123");
    expect(event.eventId).toBe("PAY_abc");
    expect(event.category).toBe("payment");
    expect(event.status).toBe("success");
    expect(event.storeId).toBe("STO_xyz");
    expect(event.mode).toBe("test");
    expect(event.summary.productName).toBe("Pro Plan");
    expect(event.summary.amount).toBe("29.00");
    expect(event.summary.currency).toBe("USD");
    expect(event.summary.buyerEmail).toBe("alice@example.com");
  });

  it("normalizes subscription.activated as subscription/success", () => {
    const event = normalizeEvent(makePayload({ eventType: "subscription.activated" }));
    expect(event.category).toBe("subscription");
    expect(event.status).toBe("success");
  });

  it("normalizes subscription.past_due as subscription/failed", () => {
    const event = normalizeEvent(makePayload({ eventType: "subscription.past_due" }));
    expect(event.category).toBe("subscription");
    expect(event.status).toBe("failed");
  });

  it("normalizes subscription.canceled as subscription/canceled", () => {
    const event = normalizeEvent(makePayload({ eventType: "subscription.canceled" }));
    expect(event.category).toBe("subscription");
    expect(event.status).toBe("canceled");
  });

  it("normalizes subscription.canceling as subscription/pending", () => {
    const event = normalizeEvent(makePayload({ eventType: "subscription.canceling" }));
    expect(event.category).toBe("subscription");
    expect(event.status).toBe("pending");
  });

  it("normalizes refund.succeeded as refund/success", () => {
    const event = normalizeEvent(makePayload({
      eventType: "refund.succeeded",
      data: { refundAmount: "15.00", currency: "EUR", buyerEmail: "bob@test.com" },
    }));
    expect(event.category).toBe("refund");
    expect(event.status).toBe("success");
    expect(event.summary.amount).toBe("15.00");
  });

  it("normalizes refund.failed as refund/failed", () => {
    const event = normalizeEvent(makePayload({ eventType: "refund.failed" }));
    expect(event.category).toBe("refund");
    expect(event.status).toBe("failed");
  });

  it("uses fallback values for missing data fields", () => {
    const event = normalizeEvent(makePayload({ data: {} }));
    expect(event.summary.productName).toBe("Unknown");
    expect(event.summary.amount).toBe("0");
    expect(event.summary.currency).toBe("USD");
    expect(event.summary.buyerEmail).toBe("unknown");
  });

  it("preserves rawData and timestamp", () => {
    const payload = makePayload();
    const event = normalizeEvent(payload);
    expect(event.rawData).toEqual(payload.data);
    expect(event.timestamp).toBe("2026-04-06T10:00:00Z");
  });
});
