export const PANCAKE_WEBHOOK_EVENT_TYPES = [
  "order.completed",
  "subscription.activated",
  "subscription.payment_succeeded",
  "subscription.updated",
  "subscription.canceling",
  "subscription.uncanceled",
  "subscription.canceled",
  "subscription.past_due",
  "refund.succeeded",
  "refund.failed",
] as const;

export type PancakeWebhookEventType = (typeof PANCAKE_WEBHOOK_EVENT_TYPES)[number];

export interface PancakeWebhookPayload {
  id: string;
  timestamp: string;
  eventType: PancakeWebhookEventType;
  eventId: string;
  storeId: string;
  mode: "test" | "prod";
  data: PancakeWebhookData;
}

export interface PancakeWebhookData {
  orderId?: string;
  buyerEmail?: string;
  currency?: string;
  amount?: string;
  taxAmount?: string;
  productName?: string;
  productId?: string;
  subscriptionId?: string;
  interval?: string;
  currentPeriodEnd?: string;
  customerId?: string;
  refundId?: string;
  refundAmount?: string;
  refundReason?: string;
  failureReason?: string;
  [key: string]: unknown;
}

export type StandardEventCategory = "payment" | "subscription" | "refund";
export type StandardEventStatus = "success" | "failed" | "pending" | "canceled";

export interface PancakeEvent {
  deliveryId: string;
  eventId: string;
  originalType: PancakeWebhookEventType;
  category: StandardEventCategory;
  status: StandardEventStatus;
  storeId: string;
  mode: "test" | "prod";
  summary: EventSummary;
  rawData: PancakeWebhookData;
  timestamp: string;
}

export interface EventSummary {
  productName: string;
  amount: string;
  currency: string;
  buyerEmail: string;
}

export type ProcessingStatus =
  | "received"
  | "verified"
  | "normalized"
  | "agent_triggered"
  | "agent_completed"
  | "agent_failed";

export interface AgentResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}

export interface EventRecord {
  deliveryId: string;
  event: PancakeEvent;
  processingStatus: ProcessingStatus;
  agentResult?: AgentResult;
  receivedAt: string;
  processedAt?: string;
}

export interface PancakeState {
  processedIds: string[];
  events: EventRecord[];
  stats: {
    totalReceived: number;
    totalTriggered: number;
    totalFailed: number;
    lastEventAt: string | null;
  };
}
