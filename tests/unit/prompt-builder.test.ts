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
    storeId: "STO_demo",
    storeName: "Waffo Demo Store",
    mode: "prod",
    summary: {
      productName: "Pro Plan",
      amount: "29.00",
      currency: "USD",
      buyerEmail: "buyer@example.com",
    },
    rawData: {
      orderId: "ORD_5dXBtmF2HLlHfbPNm0Wcnz",
      taxAmount: "2.90",
      billingDetail: { country: "US", isBusiness: false },
    },
    timestamp: "2026-03-10T08:30:00.000Z",
    ...overrides,
  };
}

describe("buildPrompt — Chinese (Feishu)", () => {
  it("renders order.completed with all universal fields", () => {
    const text = buildPrompt(makeEvent());
    expect(text).toContain("✅ 支付成功");
    expect(text).toContain("商品：Pro Plan");
    expect(text).toContain("金额：USD 29.00（含税 2.90）");
    expect(text).toContain("买家邮箱：buyer@example.com");
    expect(text).toContain("国家：US");
    expect(text).toContain("买家类型：个人");
    expect(text).toContain("订单号：ORD_5dXBtmF2HLlHfbPNm0Wcnz");
  });

  it("includes button URL with /payments resource", () => {
    const text = buildPrompt(makeEvent());
    expect(text).toContain("查看订单：https://pancake.waffo.ai/merchant/dashboard/STO_demo/payments");
  });

  it("includes brand footer with store name and Beijing time", () => {
    const text = buildPrompt(makeEvent());
    // 2026-03-10T08:30:00 UTC + 8h = 2026-03-10 16:30 Beijing
    expect(text).toContain("waffo.ai · Waffo Demo Store · 2026-03-10 16:30");
    expect(text).not.toMatch(/UTC$/m);
  });

  it("prefixes [TEST] for test mode", () => {
    expect(buildPrompt(makeEvent({ mode: "test" }))).toMatch(/^\[TEST\] /);
    expect(buildPrompt(makeEvent({ mode: "prod" }))).not.toContain("[TEST]");
  });

  it("renders 企业 for business customer", () => {
    const text = buildPrompt(makeEvent({
      rawData: { ...makeEvent().rawData, billingDetail: { country: "DE", isBusiness: true } },
    }));
    expect(text).toContain("买家类型：企业");
    expect(text).toContain("国家：DE");
  });

  it("uses — for missing optional fields", () => {
    const text = buildPrompt(makeEvent({ rawData: {}, storeName: undefined }));
    expect(text).toContain("国家：—");
    expect(text).toContain("买家类型：—");
    expect(text).toContain("订单号：—");
    expect(text).toContain("waffo.ai · — · ");
  });

  it("hides tax suffix when taxAmount is 0 or missing", () => {
    const text = buildPrompt(makeEvent({
      rawData: { ...makeEvent().rawData, taxAmount: "0.00" },
    }));
    expect(text).toContain("金额：USD 29.00");
    expect(text).not.toContain("含税");
  });

  it("renders subscription.payment_succeeded with renewal-specific fields", () => {
    const text = buildPrompt(makeEvent({
      originalType: "subscription.payment_succeeded",
      rawData: {
        orderId: "ORD_x",
        taxAmount: "2.90",
        billingPeriod: "monthly",
        currentPeriodEnd: "2026-05-10T00:00:00.000Z",
        billingDetail: { country: "US", isBusiness: false },
      },
    }));
    expect(text).toContain("💰 续费成功");
    expect(text).toContain("续费金额：USD 29.00（含税 2.90）");
    expect(text).toContain("订阅周期：monthly");
    expect(text).toContain("下次扣款：2026-05-10");
  });

  it("renders subscription.past_due with card last 4 + failure reason", () => {
    const text = buildPrompt(makeEvent({
      originalType: "subscription.past_due",
      rawData: {
        orderId: "ORD_x",
        taxAmount: "2.90",
        paymentLast4: "4242",
        currentPeriodEnd: "2026-05-10T00:00:00.000Z",
        failureReason: "card_declined",
        billingDetail: { country: "US", isBusiness: false },
      },
    }));
    expect(text).toContain("❗ 续费失败");
    expect(text).toContain("卡尾号：4242");
    expect(text).toContain("到期日：2026-05-10");
    expect(text).toContain("失败原因：card_declined");
  });

  it("renders refund.succeeded with /refunds resource and refund reason", () => {
    const text = buildPrompt(makeEvent({
      originalType: "refund.succeeded",
      category: "refund",
      rawData: {
        orderId: "ORD_x",
        refundAmount: "29.00",
        refundReason: "Customer request",
        billingDetail: { country: "US", isBusiness: false },
      },
    }));
    expect(text).toContain("💸 退款成功");
    expect(text).toContain("退款金额：USD 29.00");
    expect(text).toContain("退款原因：Customer request");
    expect(text).toContain("查看退款：https://pancake.waffo.ai/merchant/dashboard/STO_demo/refunds");
  });
});

describe("buildPrompt — English (Discord/Telegram/Slack)", () => {
  it("uses English labels and UTC time for non-Feishu channels", () => {
    const text = buildPrompt(makeEvent(), { channel: "telegram" });
    expect(text).toContain("✅ Payment Succeeded");
    expect(text).toContain("Product: Pro Plan");
    expect(text).toContain("Amount: USD 29.00 (incl. tax 2.90)");
    expect(text).toContain("Customer Email: buyer@example.com");
    expect(text).toContain("Country: US");
    expect(text).toContain("Customer Type: Individual");
    expect(text).toContain("Order ID: ORD_5dXBtmF2HLlHfbPNm0Wcnz");
    expect(text).toContain("View Order: https://pancake.waffo.ai/merchant/dashboard/STO_demo/payments");
    expect(text).toContain("waffo.ai · Waffo Demo Store · 2026-03-10 08:30 UTC");
  });

  it("renders Business customer type in English", () => {
    const text = buildPrompt(makeEvent({
      rawData: { ...makeEvent().rawData, billingDetail: { country: "DE", isBusiness: true } },
    }), { channel: "slack" });
    expect(text).toContain("Customer Type: Business");
  });

  it("renders subscription.updated with New Product / New Amount", () => {
    const text = buildPrompt(makeEvent({
      originalType: "subscription.updated",
      summary: { productName: "Pro Plan Yearly", amount: "299.00", currency: "USD", buyerEmail: "buyer@example.com" },
      rawData: {
        orderId: "ORD_x",
        taxAmount: "29.90",
        billingPeriod: "yearly",
        currentPeriodEnd: "2027-04-16T00:00:00.000Z",
        billingDetail: { country: "US", isBusiness: false },
      },
    }), { channel: "discord" });
    expect(text).toContain("🔄 Subscription Updated");
    expect(text).toContain("New Product: Pro Plan Yearly");
    expect(text).toContain("New Amount: USD 299.00 (incl. tax 29.90)");
    expect(text).toContain("Billing Period: yearly");
    expect(text).toContain("Next Charge: 2027-04-16");
  });
});

describe("buildPrompt — real Pancake payload shape", () => {
  // Field names taken from a live ~/.openclaw/pancake-state.json event on 2026-05-07
  const realPaymentSucceededRaw = {
    orderId: "ORD_1V0zVHOsyKkCUQbaQVcvRe",
    orderStatus: "active",
    buyerEmail: "huiling.mo@waffo.com",
    currency: "USD",
    amount: "3.00",
    taxAmount: "0.00",
    productName: "test2",
    paymentId: "PAY_48aRwaQzo6hgiQqpjB6ugK",
    paymentStatus: "succeeded",
    paymentDate: "2026-05-05",
    paymentMethod: "card",
    paymentLast4: "4242",
    billingPeriod: "weekly",
    billingDetail: { country: "SG", isBusiness: false },
  };

  it("renders billingPeriod (not interval) and paymentLast4 (not cardLast4)", () => {
    const text = buildPrompt({
      deliveryId: "PAY_x",
      eventId: "PAY_x",
      originalType: "subscription.past_due",
      category: "subscription",
      status: "failed",
      storeId: "STO_demo",
      storeName: "Waffo Demo Store",
      mode: "test",
      summary: { productName: "test2", amount: "3.00", currency: "USD", buyerEmail: "huiling.mo@waffo.com" },
      rawData: realPaymentSucceededRaw,
      timestamp: "2026-05-05T13:20:17.800Z",
    });
    expect(text).toContain("卡尾号：4242");
    expect(text).toContain("订单号：ORD_1V0zVHOsyKkCUQbaQVcvRe");
    expect(text).not.toContain("卡尾号：—");
  });

  it("falls back to currentPeriodEnd for canceled subscription with no canceledAt", () => {
    const text = buildPrompt({
      deliveryId: "ORD_x",
      eventId: "ORD_x",
      originalType: "subscription.canceled",
      category: "subscription",
      status: "canceled",
      storeId: "STO_demo",
      storeName: "Waffo Demo Store",
      mode: "test",
      summary: { productName: "Pro", amount: "0.00", currency: "USD", buyerEmail: "x@waffo.com" },
      rawData: {
        orderId: "ORD_7LnCcUJuXZXbaSJR52i1vn",
        billingPeriod: "monthly",
        currentPeriodEnd: "2026-05-30",
      },
      timestamp: "2026-04-30T03:00:00.000Z",
    });
    expect(text).toContain("终止时间：2026-05-30 00:00 UTC");
  });
});

describe("buildPrompt — channel routing", () => {
  it("defaults to Chinese when channel is not provided", () => {
    expect(buildPrompt(makeEvent())).toContain("✅ 支付成功");
  });

  it("treats lark as Chinese (alias of feishu)", () => {
    expect(buildPrompt(makeEvent(), { channel: "lark" })).toContain("商品：Pro Plan");
  });

  it("treats unknown channels as English", () => {
    expect(buildPrompt(makeEvent(), { channel: "wecom" })).toContain("Product: Pro Plan");
  });
});
