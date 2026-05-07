import type { PancakeEvent, PancakeWebhookEventType, PancakeBillingDetail } from "../types";

const DASHBOARD_BASE = "https://pancake.waffo.ai/merchant/dashboard";
const BRAND_HOME = "https://waffo.ai";
const FALLBACK = "—";

const FEISHU_CHANNELS = new Set(["feishu", "lark"]);

interface BuildPromptOptions {
  /** Delivery channel hint (feishu/lark → Chinese + Beijing time; everything else → English + UTC). */
  channel?: string;
}

interface EventLabel {
  zh: string;
  en: string;
}

const EVENT_TITLES: Record<PancakeWebhookEventType, EventLabel> = {
  "order.completed":               { zh: "✅ 支付成功",   en: "✅ Payment Succeeded" },
  "subscription.activated":        { zh: "🎉 订阅激活",   en: "🎉 Subscription Activated" },
  "subscription.payment_succeeded":{ zh: "💰 续费成功",   en: "💰 Renewal Succeeded" },
  "subscription.canceling":        { zh: "⚠️ 取消订阅",   en: "⚠️ Unsubscribing" },
  "subscription.uncanceled":       { zh: "↩️ 撤销取消",   en: "↩️ Cancellation Withdrawn" },
  "subscription.updated":          { zh: "🔄 订阅变更",   en: "🔄 Subscription Updated" },
  "subscription.canceled":         { zh: "🚫 订阅终止",   en: "🚫 Subscription Canceled" },
  "subscription.past_due":         { zh: "❗ 续费失败",   en: "❗ Renewal Failed" },
  "refund.succeeded":              { zh: "💸 退款成功",   en: "💸 Refund Succeeded" },
  "refund.failed":                 { zh: "❗ 退款失败",   en: "❗ Refund Failed" },
};

export function buildPrompt(event: PancakeEvent, options: BuildPromptOptions = {}): string {
  const isFeishu = FEISHU_CHANNELS.has((options.channel ?? "feishu").toLowerCase());
  return isFeishu ? buildChinese(event) : buildEnglish(event);
}

function buildChinese(event: PancakeEvent): string {
  const title = EVENT_TITLES[event.originalType]?.zh ?? event.originalType;
  const modePrefix = event.mode === "test" ? "[TEST] " : "";
  const lines: string[] = [`${modePrefix}${title}`, ""];

  for (const [label, value] of fields(event, "zh")) {
    lines.push(`${label}：${value}`);
  }

  lines.push("");
  lines.push(`${buttonLabel(event, "zh")}：${dashboardUrl(event)}`);
  lines.push("");
  lines.push(`waffo.ai · ${event.storeName ?? FALLBACK} · ${formatBeijingTime(event.timestamp)}`);

  return lines.join("\n");
}

function buildEnglish(event: PancakeEvent): string {
  const title = EVENT_TITLES[event.originalType]?.en ?? event.originalType;
  const modePrefix = event.mode === "test" ? "[TEST] " : "";
  const lines: string[] = [`${modePrefix}${title}`, ""];

  for (const [label, value] of fields(event, "en")) {
    lines.push(`${label}: ${value}`);
  }

  lines.push("");
  lines.push(`${buttonLabel(event, "en")}: ${dashboardUrl(event)}`);
  lines.push("");
  lines.push(`waffo.ai · ${event.storeName ?? FALLBACK} · ${formatUtcTime(event.timestamp)}`);

  return lines.join("\n");
}

type Lang = "zh" | "en";

function fields(event: PancakeEvent, lang: Lang): Array<[string, string]> {
  const data = event.rawData;
  const summary = event.summary;
  const billing: PancakeBillingDetail | undefined =
    typeof data.billingDetail === "object" && data.billingDetail !== null
      ? (data.billingDetail as PancakeBillingDetail)
      : undefined;

  const product: [string, string] = [
    label("Product", "商品", lang),
    summary.productName || FALLBACK,
  ];

  const renewalProduct: [string, string] = product;

  const newProduct: [string, string] = [
    label("New Product", "新商品", lang),
    summary.productName || FALLBACK,
  ];

  const amountValue = formatAmount(summary.currency, summary.amount, asString(data.taxAmount), lang);
  const refundAmountValue = formatAmount(summary.currency, asString(data.refundAmount) ?? summary.amount, undefined, lang);

  const amount: [string, string] = [label("Amount", "金额", lang), amountValue];
  const renewalAmount: [string, string] = [label("Renewal Amount", "续费金额", lang), amountValue];
  const newAmount: [string, string] = [label("New Amount", "新金额", lang), amountValue];
  const refundAmount: [string, string] = [label("Refund Amount", "退款金额", lang), refundAmountValue];

  const email: [string, string] = [
    label("Customer Email", "买家邮箱", lang),
    summary.buyerEmail || FALLBACK,
  ];
  const country: [string, string] = [
    label("Country", "国家", lang),
    asString(billing?.country) ?? FALLBACK,
  ];
  const customerType: [string, string] = [
    label("Customer Type", "买家类型", lang),
    formatCustomerType(billing?.isBusiness, lang),
  ];
  const orderId: [string, string] = [
    label("Order ID", "订单号", lang),
    asString(data.orderId) ?? FALLBACK,
  ];
  const billingPeriod: [string, string] = [
    label("Billing Period", "订阅周期", lang),
    asString(data.billingPeriod) ?? FALLBACK,
  ];
  const nextCharge: [string, string] = [
    label("Next Charge", "下次扣款", lang),
    formatDate(asString(data.currentPeriodEnd)),
  ];
  const cardLast4: [string, string] = [
    label("Card Last 4", "卡尾号", lang),
    asString(data.paymentLast4) ?? FALLBACK,
  ];
  const periodEnds: [string, string] = [
    label("Period Ends", "到期日", lang),
    formatDate(asString(data.currentPeriodEnd)),
  ];
  const finalTermination: [string, string] = [
    label("Final Termination Date", "实际终止日", lang),
    formatDate(asString(data.effectiveEndDate) ?? asString(data.currentPeriodEnd)),
  ];
  const canceledAt: [string, string] = [
    label("Canceled At", "终止时间", lang),
    formatUtcTime(asString(data.canceledAt) ?? asString(data.effectiveEndDate) ?? asString(data.currentPeriodEnd) ?? event.timestamp),
  ];
  const failureReason: [string, string] = [
    label("Failure Reason", "失败原因", lang),
    asString(data.failureReason) ?? FALLBACK,
  ];
  const refundReason: [string, string] = [
    label("Refund Reason", "退款原因", lang),
    asString(data.refundReason) ?? FALLBACK,
  ];

  switch (event.originalType) {
    case "order.completed":
      return [product, amount, email, country, customerType, orderId];
    case "subscription.activated":
      return [product, amount, email, country, customerType, billingPeriod, nextCharge, orderId];
    case "subscription.payment_succeeded":
      return [renewalProduct, renewalAmount, email, country, customerType, billingPeriod, nextCharge, orderId];
    case "subscription.canceling":
      return [product, amount, email, country, customerType, orderId, finalTermination];
    case "subscription.uncanceled":
      return [product, amount, email, country, customerType, billingPeriod, nextCharge, orderId];
    case "subscription.updated":
      return [newProduct, newAmount, email, country, customerType, billingPeriod, nextCharge, orderId];
    case "subscription.canceled":
      return [product, amount, email, country, customerType, orderId, canceledAt];
    case "subscription.past_due":
      return [product, renewalAmount, email, country, customerType, cardLast4, periodEnds, orderId, failureReason];
    case "refund.succeeded":
      return [product, refundAmount, email, country, customerType, orderId, refundReason];
    case "refund.failed":
      return [product, refundAmount, email, country, customerType, orderId, failureReason];
    default:
      return [product, amount, email, country, customerType, orderId];
  }
}

function label(en: string, zh: string, lang: Lang): string {
  return lang === "zh" ? zh : en;
}

function buttonLabel(event: PancakeEvent, lang: Lang): string {
  if (event.originalType.startsWith("refund.")) {
    return lang === "zh" ? "查看退款" : "View Refund";
  }
  return lang === "zh" ? "查看订单" : "View Order";
}

function dashboardUrl(event: PancakeEvent): string {
  const resource = event.originalType.startsWith("refund.") ? "refunds" : "payments";
  return `${DASHBOARD_BASE}/${event.storeId}/${resource}`;
}

function formatAmount(
  currency: string,
  amount: string,
  taxAmount: string | undefined,
  lang: Lang,
): string {
  if (!amount) return FALLBACK;
  const base = `${currency} ${amount}`;
  if (!taxAmount || taxAmount === "0" || taxAmount === "0.00") return base;
  return lang === "zh" ? `${base}（含税 ${taxAmount}）` : `${base} (incl. tax ${taxAmount})`;
}

function formatCustomerType(isBusiness: boolean | undefined, lang: Lang): string {
  if (typeof isBusiness !== "boolean") return FALLBACK;
  if (lang === "zh") return isBusiness ? "企业" : "个人";
  return isBusiness ? "Business" : "Individual";
}

function formatDate(iso: string | undefined): string {
  if (!iso) return FALLBACK;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return FALLBACK;
  return date.toISOString().slice(0, 10);
}

function formatBeijingTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return FALLBACK;
  const beijing = new Date(date.getTime() + 8 * 3600 * 1000);
  return beijing.toISOString().slice(0, 16).replace("T", " ");
}

function formatUtcTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return FALLBACK;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number") return String(value);
  return undefined;
}
