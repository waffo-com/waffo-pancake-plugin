import type { PancakeEvent } from "../types";

const EVENT_LABELS: Record<string, string> = {
  "order.completed": "订单完成 (支付成功)",
  "subscription.activated": "新订阅激活",
  "subscription.payment_succeeded": "订阅续费成功",
  "subscription.updated": "订阅信息变更",
  "subscription.canceling": "订阅取消中 (到期后失效)",
  "subscription.uncanceled": "订阅取消已撤回",
  "subscription.canceled": "订阅已取消",
  "subscription.past_due": "订阅欠费 (续费失败)",
  "refund.succeeded": "退款成功",
  "refund.failed": "退款失败",
};

export function buildPrompt(event: PancakeEvent): string {
  const { summary, originalType, category, status, mode, eventId, deliveryId } = event;
  const eventLabel = EVENT_LABELS[originalType] ?? originalType;
  const modePrefix = mode === "test" ? "[TEST] " : "";

  return `${modePrefix}Pancake 支付事件通知:

事件: ${eventLabel}
类别: ${category}
状态: ${status}
商品: ${summary.productName}
金额: ${summary.amount} ${summary.currency}
买家: ${maskEmail(summary.buyerEmail)}
事件ID: ${eventId}
交付ID: ${deliveryId}
时间: ${event.timestamp}

请将此事件通知给商户。`;
}

function maskEmail(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex < 0) return email;
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex);
  const masked = local.length > 3 ? local.slice(0, 3) + "***" : local[0] + "***";
  return masked + domain;
}
