import type {
  PancakeWebhookPayload,
  PancakeEvent,
  StandardEventCategory,
  StandardEventStatus,
} from "../types";

const EVENT_TYPE_MAP: Record<string, { category: StandardEventCategory; status: StandardEventStatus }> = {
  "order.completed":                  { category: "payment",      status: "success" },
  "subscription.activated":           { category: "subscription", status: "success" },
  "subscription.payment_succeeded":   { category: "payment",      status: "success" },
  "subscription.updated":             { category: "subscription", status: "success" },
  "subscription.canceling":           { category: "subscription", status: "pending" },
  "subscription.uncanceled":          { category: "subscription", status: "success" },
  "subscription.canceled":            { category: "subscription", status: "canceled" },
  "subscription.past_due":            { category: "subscription", status: "failed" },
  "refund.succeeded":                 { category: "refund",       status: "success" },
  "refund.failed":                    { category: "refund",       status: "failed" },
};

export function normalizeEvent(payload: PancakeWebhookPayload): PancakeEvent {
  const mapped = EVENT_TYPE_MAP[payload.eventType] ?? { category: "payment" as const, status: "pending" as const };
  const { data } = payload;

  return {
    deliveryId: payload.id,
    eventId: payload.eventId,
    originalType: payload.eventType,
    category: mapped.category,
    status: mapped.status,
    storeId: payload.storeId,
    storeName: payload.storeName,
    mode: payload.mode,
    summary: {
      productName: (data.productName as string | undefined) ?? "Unknown",
      amount: (data.amount as string | undefined) ?? (data.refundAmount as string | undefined) ?? "0",
      currency: (data.currency as string | undefined) ?? "USD",
      buyerEmail: (data.buyerEmail as string | undefined) ?? "unknown",
    },
    rawData: data,
    timestamp: payload.timestamp,
  };
}
