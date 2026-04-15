# OpenClaw Pancake Plugin - 技术方案

> **版本**: v2.0 (MVP)
> **日期**: 2026-04-06
> **产品方案**: [openclaw-pancake-plugin方案.html](参考产品方案汇报)
> **Dashboard 仓库**: [Waffo-pancake-dashboard](https://github.com/waffo-com/Waffo-pancake-dashboard)

---

## 1. 背景与目标

### 1.1 业务背景

Pancake 是 Waffo 旗下的 MoR（Merchant of Record）支付平台，商户通过 Dashboard 管理商品、订单和订阅。当前支付成功后的通知仅依赖邮件，商户需要自行开发 webhook 集成来实现自动化交付。

OpenClaw（小龙虾）是一个多渠道 AI 网关平台（`openclaw` on npm, v2026.4.2），已打通微信、Telegram、Lark、Feishu 等主流 IM 渠道。其核心架构基于 Express/Hono，通过 channel 插件机制扩展消息渠道。

**本插件的目标**：将 Pancake 的支付事件接入 OpenClaw，让商户无需开发 API 服务，仅通过安装插件 + 简单配置即可实现：
1. **实时 IM 通知** — 支付/订阅/退款等事件秒级推送到微信 / Telegram / Lark / Feishu
2. **自动化交付** — 小龙虾 Agent 根据事件自动执行后续动作

### 1.2 MVP 目标

| 能力 | MVP 范围 |
|------|---------|
| 事件接收 | Dashboard 已支持的全部 10 种事件 |
| 安全校验 | RSA-SHA256 签名验证 + 幂等去重 |
| Agent 触发 | 标准化事件 → 构建 prompt → `runEmbeddedPiAgent()` 触发 Agent |
| IM 通知 | Agent 自行通过已连接的 channels 发送（微信/TG/Lark/飞书等） |
| 查询能力 | Tool / Command 查询事件状态与失败原因 |
| 可观测性 | 全链路日志 + JSON 文件持久化 |
| 映射粒度 | 店铺级别（不支持商品级映射） |
| 通知语言 | Agent 自行处理（插件不控制语言） |

**MVP 支持的全部事件类型**（与 Dashboard Webhook 配置完全一致）：

| 事件 | 类别 | 说明 |
|------|------|------|
| `order.completed` | 支付 | 一次性订单支付成功 |
| `subscription.activated` | 订阅 | 新订阅激活 |
| `subscription.payment_succeeded` | 支付 | 订阅续费成功 |
| `subscription.updated` | 订阅 | 订阅信息变更 |
| `subscription.canceling` | 订阅 | 订阅取消中（到期后失效） |
| `subscription.uncanceled` | 订阅 | 取消操作撤回 |
| `subscription.canceled` | 订阅 | 订阅已取消 |
| `subscription.past_due` | 订阅 | 订阅欠费 |
| `refund.succeeded` | 退款 | 退款成功 |
| `refund.failed` | 退款 | 退款失败 |

### 1.3 不在 MVP 范围

- 通过插件创建/管理 Pancake 商品
- UI 报表页
- 复杂自动化编排
- 商品级通知/自动化映射

### 1.4 关键设计决策

| 决策 | 方案 | 原因 |
|------|------|------|
| Agent 触发方式 | `runEmbeddedPiAgent()` | 与 Linear 插件一致，OpenClaw 生态标准做法 |
| 通知机制 | Agent 驱动，不直接调 channel API | Agent 自行选渠道+处理语言，最简洁 |
| 状态持久化 | JSON 文件 (`~/.openclaw/pancake-state.json`) | 与 Linear 插件一致，MVP 足够 |
| 分发方式 | npm 包 (`@waffo/pancake`) | 标准做法，`openclaw plugins install` |
| 插件 SDK | `openclaw/plugin-sdk` 子路径导出 | 无独立 SDK 包，内嵌在主包中 |

---

## 2. 现有架构分析

### 2.1 Pancake 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 16 + React 19 + TypeScript + Tailwind CSS 4 |
| 数据通信 | Server Actions → GraphQL (backend: `waffo-pancake-auth-service.vercel.app`) |
| 认证 | better-auth |
| 支付 | Stripe (@waffo/payment-sdk, stripe SDK) |
| 国际化 | next-intl |
| 客户端状态 | SWR |

### 2.2 Pancake Webhook 体系（已确认）

> 以下信息已通过 GitHub 仓库 (waffo-com/Waffo-pancake-dashboard) 确认。

| 项目 | 确认结果 |
|------|---------|
| **签名** | RSA-SHA256。Header: `X-Waffo-Signature`，格式 `t=<timestamp>,v1=<base64>`。SDK `@waffo/pancake-ts` 提供 `verifyWebhook()` |
| **Payload** | `{ id: "whd_xxx", timestamp, eventType, eventId: "PAY_xxx", storeId: "STO_xxx", mode: "test"|"prod", data: {...} }` |
| **事件 ID** | `id` (whd_xxx) 交付记录 ID 用于幂等；`eventId` (PAY_xxx) 业务事件 ID |
| **重试** | QStash 消息队列，3 次重试，指数退避 |
| **Dashboard** | 无需任何改动，商户填入插件 webhook URL 即可 |

### 2.3 OpenClaw 插件 SDK

SDK 内嵌在 `openclaw` 主包中，通过 `openclaw/plugin-sdk` 子路径导出。

**`OpenClawPluginApi` 核心方法**:

| 方法 | 用途 | 我们是否需要 |
|------|------|-------------|
| `registerHttpRoute(params)` | 注册 HTTP 路由（接收 webhook） | **需要** |
| `registerTool(tool)` | 注册 Agent 可调用的 Tool | **需要** |
| `registerCommand(command)` | 注册用户可调用的命令 | **需要** |
| `registerHook(events, handler)` | 注册内部事件钩子 | 可选 |
| `registerService(service)` | 注册后台服务 | 可选 |
| `registerChannel(registration)` | 注册消息渠道 | 不需要 |

**插件注册模式** (参考 openclaw-stepfun, openclaw-linear):
```typescript
import { OpenClawPluginApi } from "openclaw/plugin-sdk";

export default {
  id: "@waffo/pancake",
  name: "Pancake Webhook",
  description: "Pancake 支付事件接收与 Agent 通知",
  configSchema: { /* JSON Schema / zod */ },
  register: (api: OpenClawPluginApi) => { /* 注册 routes/tools/commands */ }
};
```

配套文件 `openclaw.plugin.json` 声明插件元数据。

### 2.4 OpenClaw Channel 插件生态

| 渠道 | 包名 | 维护方 |
|------|------|--------|
| **微信** | `@tencent-weixin/openclaw-weixin` (v2.1.3) | 腾讯微信团队 |
| **企业微信** | `@wecom/wecom-openclaw-plugin` | 腾讯企业微信团队 |
| **Lark** | `@larksuite/openclaw-lark` | 字节 Lark 团队 |
| **飞书** | `@larksuiteoapi/feishu-openclaw-plugin` | 飞书官方 |
| Telegram | OpenClaw 内置 | — |

### 2.5 竞品分析

目前 OpenClaw 生态中**没有传统支付平台集成插件**。唯一类似方案：

| 方案 | Creem HEARTBEAT | Pancake Plugin (我们) |
|------|----------------|----------------------|
| **架构** | 轮询 (Pull) — 定时查 API 做 diff | 事件驱动 (Push) — Webhook 实时接收 |
| **实时性** | 1-4 小时延迟 | 秒级 |
| **实现方式** | Markdown 指令文档，AI agent 按指令轮询 | OpenClaw 标准插件，npm 分发 |
| **可靠性** | 轮询可能漏掉快速状态变化 | Webhook + 幂等 + QStash 重试 |

---

## 3. 系统架构

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     Pancake Backend                              │
│  Stripe Webhook → 内部事件 → QStash → 推送到商户 Webhook URL     │
│  签名: RSA-SHA256 (X-Waffo-Signature)                           │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTP POST
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                  OpenClaw Pancake Plugin                         │
│                                                                 │
│  ┌────────────┐   ┌─────────────┐   ┌────────────────────┐     │
│  │ HTTP Route │──▶│ Processor   │──▶│ Agent Trigger      │     │
│  │            │   │             │   │                    │     │
│  │ POST       │   │ - 验签      │   │ runEmbeddedPi-     │     │
│  │ /pancake/  │   │ - 幂等去重  │   │ Agent(prompt)      │     │
│  │ webhook    │   │ - 标准化    │   │                    │     │
│  └────────────┘   │ - 持久化    │   │ Agent 自行决定:     │     │
│                   └─────────────┘   │ - 发送 IM 通知     │     │
│  ┌────────────┐   ┌─────────────┐   │ - 调用商户 API     │     │
│  │ Tool       │   │ State Store │   │ - 其他自动化       │     │
│  │ - 查询事件 │──▶│             │   └────────────────────┘     │
│  │ - 查询状态 │   │ JSON 文件   │            │                  │
│  │ - 重试     │   │ ~/.openclaw/│            ▼                  │
│  │            │   │ pancake-    │   ┌────────────────────┐     │
│  │ Command    │   │ state.json  │   │ OpenClaw Channels  │     │
│  │ - /pancake │   └─────────────┘   │ 微信/TG/Lark/飞书  │     │
│  │   status   │                     └────────────────────┘     │
│  └────────────┘                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 数据流

```
Pancake Webhook POST (X-Waffo-Signature + X-Waffo-Event)
        │
        ▼
   [1] HTTP Route 接收请求 (api.registerHttpRoute)
        │
        ▼
   [2] RSA-SHA256 签名验证 (@waffo/pancake-ts verifyWebhook)
        │ 失败 → 返回 401, 记录日志
        ▼
   [3] 幂等检查 (id: whd_xxx, 内存 Map + JSON 文件)
        │ 重复 → 返回 200, 跳过处理
        ▼
   [4] 事件标准化 (PancakeWebhookPayload → PancakeEvent)
        │
        ▼
   [5] 持久化到 ~/.openclaw/pancake-state.json
        │
        ▼
   [6] 返回 200 OK 给 Pancake (先响应, 避免 QStash 超时重试)
        │
        ▼
   [7] 构建 prompt → runEmbeddedPiAgent() 触发 Agent (异步)
        │
        ▼
   [8] Agent 通过已连接的 channels 自动通知商户
       (语言由 Agent 根据用户偏好自适应)
```

**与旧方案的核心区别**: 插件不再直接调用 channel API 发通知，而是触发 Agent，由 Agent 自行决定如何通知和使用什么语言。

---

## 4. 模块详细设计

### 4.1 项目结构

```
waffo-pancake-openclaw-plugin/
├── src/
│   ├── index.ts                    # 插件入口, register() 注册一切
│   ├── config.ts                   # 插件配置 schema (zod)
│   ├── types.ts                    # 类型定义
│   │
│   ├── routes/
│   │   └── webhook.ts              # HTTP Route: POST /pancake/webhook
│   │
│   ├── processors/
│   │   ├── signature.ts            # RSA-SHA256 签名验证
│   │   ├── idempotency.ts          # 幂等去重 (内存 + JSON 持久化)
│   │   └── normalizer.ts           # 事件标准化
│   │
│   ├── agent/
│   │   ├── trigger.ts              # runEmbeddedPiAgent() 触发 Agent
│   │   └── prompt-builder.ts       # 构建事件 prompt
│   │
│   ├── store/
│   │   └── json-store.ts           # JSON 文件持久化 (~/.openclaw/pancake-state.json)
│   │
│   ├── tools/
│   │   ├── query-events.ts         # Tool: 查询事件
│   │   ├── query-status.ts         # Tool: 查询插件状态
│   │   └── retry-event.ts          # Tool: 手动重试
│   │
│   └── utils/
│       └── logger.ts               # 日志工具
│
├── tests/
│   ├── unit/
│   │   ├── signature.test.ts
│   │   ├── idempotency.test.ts
│   │   ├── normalizer.test.ts
│   │   └── prompt-builder.test.ts
│   └── integration/
│       └── webhook-flow.test.ts
│
├── openclaw.plugin.json            # 插件元数据清单
├── package.json
├── tsconfig.json
└── README.md
```

### 4.2 插件入口 (index.ts)

```typescript
import { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { handleWebhook } from "./routes/webhook";
import { queryEventsTool } from "./tools/query-events";
import { queryStatusTool } from "./tools/query-status";
import { retryEventTool } from "./tools/retry-event";
import { pluginConfigSchema } from "./config";

export default {
  id: "@waffo/pancake",
  name: "Pancake Webhook",
  description: "接收 Pancake 支付事件，触发 OpenClaw Agent 自动通知与交付",
  configSchema: pluginConfigSchema,

  register: (api: OpenClawPluginApi) => {
    // HTTP Route: 接收 Pancake Webhook
    api.registerHttpRoute({
      path: "/pancake/webhook",
      auth: "plugin",       // 插件自行验签 (RSA-SHA256)
      match: "exact",
      handler: (req, res) => handleWebhook(api, req, res),
    });

    // Tools: Agent 可调用
    api.registerTool(queryEventsTool);
    api.registerTool(queryStatusTool);
    api.registerTool(retryEventTool);

    // Command: 用户可调用
    api.registerCommand({
      name: "pancake",
      description: "Pancake 插件状态与管理",
      subcommands: {
        status: { description: "查看插件运行状态和事件统计", handler: handleStatusCommand },
        events: { description: "查看最近事件", handler: handleEventsCommand },
      },
    });
  },
};
```

### 4.3 类型定义 (types.ts)

```typescript
// ============================================================
// Pancake Webhook Payload (已确认格式)
// ============================================================

export type PancakeWebhookEventType =
  | 'order.completed'
  | 'subscription.activated'
  | 'subscription.payment_succeeded'
  | 'subscription.updated'
  | 'subscription.canceling'
  | 'subscription.uncanceled'
  | 'subscription.canceled'
  | 'subscription.past_due'
  | 'refund.succeeded'
  | 'refund.failed';

export interface PancakeWebhookPayload {
  /** 交付记录唯一 ID (whd_xxx), 用于幂等去重 */
  id: string;
  /** ISO 8601 时间戳 */
  timestamp: string;
  /** 事件类型 */
  eventType: PancakeWebhookEventType;
  /** 业务事件 ID (PAY_xxx / SUB_xxx 等) */
  eventId: string;
  /** 商户 Store ID (STO_xxx) */
  storeId: string;
  /** 环境: test | prod */
  mode: 'test' | 'prod';
  /** 事件数据 (内容因 eventType 不同而不同) */
  data: {
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
  };
}

// ============================================================
// 标准化内部事件
// ============================================================

export type StandardEventCategory = 'payment' | 'subscription' | 'refund';
export type StandardEventStatus = 'success' | 'failed' | 'pending' | 'canceled';

export interface PancakeEvent {
  deliveryId: string;                       // whd_xxx (幂等)
  eventId: string;                          // PAY_xxx (业务 ID)
  originalType: PancakeWebhookEventType;
  category: StandardEventCategory;
  status: StandardEventStatus;
  storeId: string;
  mode: 'test' | 'prod';
  summary: {
    productName: string;
    amount: string;
    currency: string;
    buyerEmail: string;
  };
  rawData: PancakeWebhookPayload['data'];
  timestamp: string;
}

// ============================================================
// 事件处理记录
// ============================================================

export type ProcessingStatus =
  | 'received'
  | 'verified'
  | 'normalized'
  | 'agent_triggered'       // 已触发 Agent
  | 'agent_completed'       // Agent 处理完成
  | 'agent_failed';         // Agent 触发失败

export interface EventRecord {
  deliveryId: string;
  event: PancakeEvent;
  processingStatus: ProcessingStatus;
  agentResult?: {
    success: boolean;
    sessionId?: string;
    error?: string;
  };
  receivedAt: string;
  processedAt?: string;
}
```

### 4.4 插件配置 (config.ts)

```typescript
import { z } from "openclaw/plugin-sdk/zod";

export const pluginConfigSchema = z.object({
  /** 环境模式 */
  mode: z.enum(["test", "prod"]).default("test"),
  /** 日志级别 */
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type PancakePluginConfig = z.infer<typeof pluginConfigSchema>;
```

配置极简 — 不需要配置通知渠道（Agent 自行选择已连接的 channels），不需要配置 webhook secret（RSA 公钥内置）。

### 4.5 Webhook 接收 (routes/webhook.ts)

```typescript
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { verifyWebhook } from "@waffo/pancake-ts";
import { checkIdempotency, markProcessed } from "../processors/idempotency";
import { normalizeEvent } from "../processors/normalizer";
import { triggerAgent } from "../agent/trigger";
import { saveEvent, updateEventStatus } from "../store/json-store";
import { logger } from "../utils/logger";
import type { PancakeWebhookPayload } from "../types";

export async function handleWebhook(
  api: OpenClawPluginApi,
  req: IncomingMessage,
  res: ServerResponse
) {
  // 读取 body
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString("utf8");

  const signatureHeader = req.headers["x-waffo-signature"] as string | undefined;

  // Step 1: RSA-SHA256 签名验证 (使用官方 SDK)
  const payload: PancakeWebhookPayload = JSON.parse(body);
  const isValid = verifyWebhook(body, signatureHeader, payload.mode);
  if (!isValid) {
    logger.warn("Webhook signature verification failed");
    res.writeHead(401);
    res.end("Unauthorized");
    return;
  }

  // Step 2: 幂等检查 (whd_xxx)
  if (await checkIdempotency(payload.id)) {
    logger.info(`Duplicate delivery ignored: ${payload.id}`);
    res.writeHead(200);
    res.end("OK");
    return;
  }

  // Step 3: 标准化
  const event = normalizeEvent(payload);

  // Step 4: 持久化
  await saveEvent(event);
  await markProcessed(payload.id);

  // Step 5: 立即返回 200 (避免 QStash 超时重试)
  res.writeHead(200);
  res.end("OK");

  // Step 6: 异步触发 Agent
  try {
    const result = await triggerAgent(api, event);
    await updateEventStatus(event.deliveryId, "agent_triggered", { agentResult: result });
  } catch (err) {
    logger.error(`Agent trigger failed for ${event.deliveryId}:`, err);
    await updateEventStatus(event.deliveryId, "agent_failed", {
      agentResult: { success: false, error: String(err) },
    });
  }
}
```

### 4.6 Agent 触发 (agent/trigger.ts)

```typescript
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PancakeEvent } from "../types";
import { buildPrompt } from "./prompt-builder";

/**
 * 触发 OpenClaw Agent 处理支付事件
 *
 * 与 Linear 插件模式一致:
 * 插件构建 prompt → runEmbeddedPiAgent() → Agent 自行决定后续动作
 * Agent 会根据用户已连接的 channels 自动发送通知, 语言自适应
 */
export async function triggerAgent(
  api: OpenClawPluginApi,
  event: PancakeEvent
): Promise<{ success: boolean; sessionId?: string }> {
  const prompt = buildPrompt(event);

  // 使用 store-level sessionId, 同一店铺的事件共享 session 上下文
  const sessionId = `pancake-${event.storeId}-${event.mode}`;

  const result = await api.runtime.agent.runEmbeddedPiAgent({
    sessionId,
    prompt,
  });

  return { success: true, sessionId };
}
```

### 4.7 Prompt 构建 (agent/prompt-builder.ts)

```typescript
import type { PancakeEvent } from "../types";

/**
 * 将标准化事件构建为 Agent 可理解的 prompt
 *
 * Agent 收到 prompt 后自行决定:
 * - 通过哪个 channel 通知商户
 * - 使用什么语言
 * - 是否需要执行其他自动化动作
 */
export function buildPrompt(event: PancakeEvent): string {
  const { summary, originalType, category, status, mode, eventId, deliveryId } = event;

  const eventLabel = EVENT_LABELS[originalType] ?? originalType;
  const modeLabel = mode === "test" ? "[TEST] " : "";

  return `${modeLabel}Pancake 支付事件通知:

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

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const masked = local.length > 3
    ? local.slice(0, 3) + "***"
    : local[0] + "***";
  return `${masked}@${domain}`;
}
```

### 4.8 签名验证 (processors/signature.ts)

**推荐**: 直接使用 `@waffo/pancake-ts` SDK 的 `verifyWebhook()` 函数（内置 Test/Prod 公钥）。

如果需要手动验证（备选）:

```typescript
import { createVerify } from "crypto";

// RSA-SHA256 签名规范:
// Header: X-Waffo-Signature, 格式: t=<timestamp>,v1=<base64_signature>
// 签名内容: RSA-SHA256(`${timestamp}.${rawBody}`, privateKey)
// 防重放: 5 分钟窗口

const PANCAKE_PUBLIC_KEYS = {
  test: "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
  prod: "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
};

export function verifySignature(body: string, header: string, mode: "test" | "prod"): boolean {
  const parsed = parseHeader(header); // 解析 t= 和 v1=
  if (!parsed) return false;

  // 防重放
  if (Math.abs(Date.now() - parseInt(parsed.timestamp) * 1000) > 5 * 60 * 1000) return false;

  // RSA-SHA256 验证
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${parsed.timestamp}.${body}`);
  return verifier.verify(PANCAKE_PUBLIC_KEYS[mode], parsed.signature, "base64");
}
```

### 4.9 幂等去重 (processors/idempotency.ts)

```typescript
import { loadState, saveState } from "../store/json-store";

const processedIds = new Map<string, number>(); // 内存缓存
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 幂等检查: 内存 Map (快) + JSON 文件 (持久化)
 * Pancake 使用 QStash 重试 (3次, 指数退避), whd_xxx ID 保持不变
 */
export async function checkIdempotency(deliveryId: string): Promise<boolean> {
  // 先查内存
  if (processedIds.has(deliveryId)) return true;

  // 再查持久化
  const state = await loadState();
  return state.processedIds.includes(deliveryId);
}

export async function markProcessed(deliveryId: string): Promise<void> {
  processedIds.set(deliveryId, Date.now());
  cleanup();

  // 同步到 JSON 文件
  const state = await loadState();
  state.processedIds.push(deliveryId);
  // 只保留最近 1000 条
  if (state.processedIds.length > 1000) {
    state.processedIds = state.processedIds.slice(-500);
  }
  await saveState(state);
}

function cleanup() {
  const now = Date.now();
  for (const [id, ts] of processedIds) {
    if (now - ts > TTL_MS) processedIds.delete(id);
  }
}
```

### 4.10 JSON 文件持久化 (store/json-store.ts)

```typescript
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const STATE_DIR = join(homedir(), ".openclaw");
const STATE_FILE = join(STATE_DIR, "pancake-state.json");

export interface PancakeState {
  processedIds: string[];        // 已处理的 delivery IDs
  events: EventRecord[];         // 最近事件记录 (保留最近 200 条)
  stats: {
    totalReceived: number;
    totalTriggered: number;
    totalFailed: number;
    lastEventAt: string | null;
  };
}

const DEFAULT_STATE: PancakeState = {
  processedIds: [],
  events: [],
  stats: { totalReceived: 0, totalTriggered: 0, totalFailed: 0, lastEventAt: null },
};

export async function loadState(): Promise<PancakeState> {
  try {
    const data = await readFile(STATE_FILE, "utf8");
    return { ...DEFAULT_STATE, ...JSON.parse(data) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function saveState(state: PancakeState): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

export async function saveEvent(event: PancakeEvent): Promise<void> {
  const state = await loadState();
  state.events.push({ deliveryId: event.deliveryId, event, processingStatus: "received", receivedAt: new Date().toISOString() });
  if (state.events.length > 200) state.events = state.events.slice(-200);
  state.stats.totalReceived++;
  state.stats.lastEventAt = new Date().toISOString();
  await saveState(state);
}

export async function updateEventStatus(
  deliveryId: string,
  status: ProcessingStatus,
  extra?: Record<string, unknown>
): Promise<void> {
  const state = await loadState();
  const record = state.events.find(e => e.deliveryId === deliveryId);
  if (record) {
    record.processingStatus = status;
    record.processedAt = new Date().toISOString();
    if (extra) Object.assign(record, extra);
  }
  if (status === "agent_triggered") state.stats.totalTriggered++;
  if (status === "agent_failed") state.stats.totalFailed++;
  await saveState(state);
}
```

### 4.11 Tools (tools/)

```typescript
// tools/query-events.ts
export const queryEventsTool = {
  name: "pancake_query_events",
  description: "查询 Pancake 最近的支付/订阅/退款事件",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number", description: "返回数量 (默认 10, 最大 50)" },
      category: { type: "string", enum: ["payment", "subscription", "refund"] },
      status: { type: "string", enum: ["success", "failed", "pending", "canceled"] },
    },
  },
  handler: async (params) => {
    const state = await loadState();
    let events = state.events;
    if (params.category) events = events.filter(e => e.event.category === params.category);
    if (params.status) events = events.filter(e => e.event.status === params.status);
    return events.slice(-(params.limit ?? 10));
  },
};

// tools/query-status.ts
export const queryStatusTool = {
  name: "pancake_status",
  description: "查询 Pancake 插件运行状态和统计",
  parameters: { type: "object", properties: {} },
  handler: async () => {
    const state = await loadState();
    return {
      totalReceived: state.stats.totalReceived,
      totalTriggered: state.stats.totalTriggered,
      totalFailed: state.stats.totalFailed,
      lastEventAt: state.stats.lastEventAt,
      recentFailures: state.events
        .filter(e => e.processingStatus === "agent_failed")
        .slice(-5),
    };
  },
};

// tools/retry-event.ts
export const retryEventTool = {
  name: "pancake_retry_event",
  description: "手动重试失败的 Pancake 事件",
  parameters: {
    type: "object",
    properties: {
      deliveryId: { type: "string", description: "交付记录 ID (whd_xxx)" },
    },
    required: ["deliveryId"],
  },
  handler: async (params, api) => {
    const state = await loadState();
    const record = state.events.find(e => e.deliveryId === params.deliveryId);
    if (!record) return { error: "Event not found" };
    // 重新触发 Agent
    const result = await triggerAgent(api, record.event);
    return { success: true, ...result };
  },
};
```

---

## 5. Pancake Dashboard 侧

### 无需任何改动

Pancake Dashboard 的 webhook 能力已完整实现：
- RSA-SHA256 签名验证
- Test/Prod 双环境 webhook URL 配置
- 10 种事件类型全部支持推送
- QStash 队列保证可靠交付 + 3 次重试
- Dashboard 展示交付日志

**商户只需在 Dashboard Settings > Webhooks 中填入插件的 webhook URL 即可。**

---

## 6. 安全设计

### 6.1 传输安全

- Webhook URL 强制 HTTPS
- RSA-SHA256 非对称签名验证（公钥可安全内置）
- 5 分钟 timestamp 防重放窗口
- 推荐使用 `@waffo/pancake-ts` SDK 的 `verifyWebhook()`

### 6.2 数据安全

- 邮箱脱敏后再传给 Agent（`alex***@gmail.com`）
- RSA 公钥内置无安全风险
- 状态文件存储在 `~/.openclaw/` 目录（OpenClaw 标准路径）

### 6.3 可用性

- 先返回 200 再异步触发 Agent，避免 QStash 超时重试
- 内存 + JSON 文件双层幂等去重
- Agent 触发失败记录到状态文件，支持手动重试

---

## 7. 风险与应对

| 风险 | 级别 | 应对 |
|------|------|------|
| 本地部署用户无公网 webhook 地址 | **高** | 提供 ngrok/cloudflared tunnel 教程; 后续考虑内置 tunnel |
| 小龙虾 Agent 处理事件的 prompt 需要迭代优化 | **中** | MVP 先用简单 prompt, 根据实际效果迭代 |
| JSON 文件并发写入可能冲突 | **中** | MVP 可接受(webhook 不会高并发); 后续可加文件锁或升级 SQLite |
| 微信 ClawBot 需扫码激活 | **中** | 提供清晰的前置条件说明 |

---

## 8. 开发计划

### Phase 1: 核心链路 (约 1 周)

- [ ] 项目脚手架 (TypeScript + openclaw.plugin.json + 测试框架)
- [ ] 类型定义 (types.ts)
- [ ] 插件入口 (index.ts — registerHttpRoute + registerTool + registerCommand)
- [ ] RSA-SHA256 签名验证 (集成 @waffo/pancake-ts)
- [ ] 幂等去重 (内存 + JSON)
- [ ] 事件标准化
- [ ] JSON 文件持久化
- [ ] 单元测试

### Phase 2: Agent 触发 + Tools (约 1 周)

- [ ] Prompt 构建 (10 种事件类型)
- [ ] runEmbeddedPiAgent() 集成
- [ ] Tool: pancake_query_events
- [ ] Tool: pancake_status
- [ ] Tool: pancake_retry_event
- [ ] Command: /pancake status, /pancake events
- [ ] 集成测试

### Phase 3: 联调 + 上线 (约 0.5 周)

- [ ] 与 Pancake Dashboard 联调 (test mode webhook)
- [ ] Agent 通知效果验证 (微信/TG/Lark/飞书)
- [ ] prompt 优化迭代
- [ ] README + 安装指南
- [ ] 发布到 npm (`@waffo/pancake`)
- [ ] `openclaw plugins install @waffo/pancake` 验证
