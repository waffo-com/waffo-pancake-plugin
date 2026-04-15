# OpenClaw Pancake Plugin MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an OpenClaw plugin that receives Pancake payment webhook events, verifies signatures, deduplicates, normalizes, and triggers the OpenClaw Agent to notify merchants via IM channels.

**Architecture:** Plugin registers an HTTP route (`POST /pancake/webhook`) via `openclaw/plugin-sdk`. Incoming webhooks are verified (RSA-SHA256), deduplicated (delivery ID), normalized to `PancakeEvent`, persisted to a JSON state file (`~/.openclaw/pancake-state.json`), then passed as a prompt to `runEmbeddedPiAgent()`. The Agent handles notification delivery and language. Three Tools and one Command provide query/retry capabilities.

**Tech Stack:** TypeScript, `openclaw/plugin-sdk`, `@waffo/pancake-ts` (webhook verification), `zod` (config schema), `vitest` (testing)

**Spec:** `docs/technical-design.md` v2.0

---

## File Map

| File | Responsibility |
|------|---------------|
| `src/index.ts` | Plugin entry — default export with `register()`, wires routes/tools/commands |
| `src/config.ts` | Plugin config schema (zod) |
| `src/types.ts` | All type definitions (payload, event, record, status) |
| `src/routes/webhook.ts` | HTTP handler for `POST /pancake/webhook` |
| `src/processors/signature.ts` | RSA-SHA256 signature verification wrapper |
| `src/processors/idempotency.ts` | Delivery ID dedup (memory + JSON file) |
| `src/processors/normalizer.ts` | `PancakeWebhookPayload` → `PancakeEvent` |
| `src/agent/trigger.ts` | `runEmbeddedPiAgent()` invocation |
| `src/agent/prompt-builder.ts` | Event → prompt string |
| `src/store/json-store.ts` | JSON file persistence (`~/.openclaw/pancake-state.json`) |
| `src/tools/query-events.ts` | Tool: query recent events |
| `src/tools/query-status.ts` | Tool: plugin status/stats |
| `src/tools/retry-event.ts` | Tool: retry failed event |
| `src/utils/logger.ts` | Thin logger wrapper |
| `openclaw.plugin.json` | Plugin manifest |
| `package.json` | Dependencies and scripts |
| `tsconfig.json` | TypeScript config |
| `tests/unit/normalizer.test.ts` | Normalizer unit tests |
| `tests/unit/idempotency.test.ts` | Idempotency unit tests |
| `tests/unit/prompt-builder.test.ts` | Prompt builder unit tests |
| `tests/unit/json-store.test.ts` | JSON store unit tests |
| `tests/integration/webhook-flow.test.ts` | End-to-end webhook flow test |

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `openclaw.plugin.json`
- Create: `src/utils/logger.ts`
- Create: `vitest.config.ts`

- [ ] **Step 1: Initialize package.json**

```bash
cd /Users/huiling.mo/waffo.project/waffo-pancake-openclaw-plugin/waffo-pancake-openclaw-plugin
```

Create `package.json`:

```json
{
  "name": "@waffo/pancake",
  "version": "0.1.0",
  "description": "OpenClaw plugin for Pancake payment webhook events",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist", "openclaw.plugin.json"],
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit"
  },
  "keywords": ["openclaw", "openclaw-plugin", "pancake", "webhook", "payment"],
  "author": "Waffo Team",
  "license": "MIT",
  "dependencies": {
    "@waffo/pancake-ts": "^1.0.0",
    "zod": "^3.23.0"
  },
  "peerDependencies": {
    "openclaw": ">=2026.0.0"
  },
  "devDependencies": {
    "openclaw": "^2026.4.2",
    "typescript": "^5.9.0",
    "vitest": "^3.1.0",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Create openclaw.plugin.json**

```json
{
  "id": "@waffo/pancake",
  "name": "Pancake Webhook",
  "description": "接收 Pancake 支付事件，触发 OpenClaw Agent 自动通知与交付",
  "version": "0.1.0",
  "configSchema": {
    "type": "object",
    "properties": {
      "mode": {
        "type": "string",
        "enum": ["test", "prod"],
        "default": "test",
        "description": "Pancake environment mode"
      },
      "logLevel": {
        "type": "string",
        "enum": ["debug", "info", "warn", "error"],
        "default": "info"
      }
    }
  }
}
```

- [ ] **Step 5: Create logger utility**

Create `src/utils/logger.ts`:

```typescript
export const logger = {
  debug: (...args: unknown[]) => console.debug("[pancake]", ...args),
  info: (...args: unknown[]) => console.info("[pancake]", ...args),
  warn: (...args: unknown[]) => console.warn("[pancake]", ...args),
  error: (...args: unknown[]) => console.error("[pancake]", ...args),
};
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`

- [ ] **Step 7: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors (only logger.ts exists, no imports to fail)

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts openclaw.plugin.json src/utils/logger.ts
git commit -m "chore: scaffold project with TypeScript, vitest, openclaw plugin manifest"
```

---

### Task 2: Type Definitions

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Create types.ts with all type definitions**

Create `src/types.ts`:

```typescript
// ============================================================
// Pancake Webhook Payload (confirmed format from Pancake Backend)
// ============================================================

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
  /** Delivery record ID (whd_xxx) — used for idempotency */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Event type */
  eventType: PancakeWebhookEventType;
  /** Business event ID (PAY_xxx / SUB_xxx) */
  eventId: string;
  /** Merchant Store ID (STO_xxx) */
  storeId: string;
  /** Environment */
  mode: "test" | "prod";
  /** Event data — shape varies by eventType */
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

// ============================================================
// Normalized internal event
// ============================================================

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

// ============================================================
// Processing records
// ============================================================

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

// ============================================================
// State file
// ============================================================

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
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add type definitions for webhook payload, events, and state"
```

---

### Task 3: Config Schema

**Files:**
- Create: `src/config.ts`

- [ ] **Step 1: Create config.ts**

```typescript
import { z } from "zod";

export const pluginConfigSchema = z.object({
  mode: z.enum(["test", "prod"]).default("test"),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type PancakePluginConfig = z.infer<typeof pluginConfigSchema>;
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: add plugin config schema with zod"
```

---

### Task 4: Event Normalizer (TDD)

**Files:**
- Create: `src/processors/normalizer.ts`
- Create: `tests/unit/normalizer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/normalizer.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/normalizer.test.ts`
Expected: FAIL — module `../../src/processors/normalizer` not found

- [ ] **Step 3: Implement normalizer**

Create `src/processors/normalizer.ts`:

```typescript
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
    mode: payload.mode,
    summary: {
      productName: data.productName ?? "Unknown",
      amount: data.amount ?? data.refundAmount ?? "0",
      currency: data.currency ?? "USD",
      buyerEmail: data.buyerEmail ?? "unknown",
    },
    rawData: data,
    timestamp: payload.timestamp,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/normalizer.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/processors/normalizer.ts tests/unit/normalizer.test.ts
git commit -m "feat: add event normalizer with full event type mapping"
```

---

### Task 5: Idempotency (TDD)

**Files:**
- Create: `src/processors/idempotency.ts`
- Create: `tests/unit/idempotency.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/idempotency.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { checkIdempotency, markProcessed, resetForTesting } from "../../src/processors/idempotency";

describe("idempotency", () => {
  beforeEach(() => {
    resetForTesting();
  });

  it("returns false for a new delivery ID", async () => {
    expect(await checkIdempotency("whd_new")).toBe(false);
  });

  it("returns true for an already-processed delivery ID", async () => {
    await markProcessed("whd_dup");
    expect(await checkIdempotency("whd_dup")).toBe(true);
  });

  it("handles multiple different IDs independently", async () => {
    await markProcessed("whd_a");
    expect(await checkIdempotency("whd_a")).toBe(true);
    expect(await checkIdempotency("whd_b")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/idempotency.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement idempotency (memory-only for now, JSON integration in Task 6)**

Create `src/processors/idempotency.ts`:

```typescript
const TTL_MS = 24 * 60 * 60 * 1000;
const processedIds = new Map<string, number>();

export async function checkIdempotency(deliveryId: string): Promise<boolean> {
  cleanup();
  return processedIds.has(deliveryId);
}

export async function markProcessed(deliveryId: string): Promise<void> {
  processedIds.set(deliveryId, Date.now());
}

function cleanup(): void {
  const now = Date.now();
  for (const [id, ts] of processedIds) {
    if (now - ts > TTL_MS) {
      processedIds.delete(id);
    }
  }
}

/** Reset state for testing only */
export function resetForTesting(): void {
  processedIds.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/idempotency.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/processors/idempotency.ts tests/unit/idempotency.test.ts
git commit -m "feat: add idempotency dedup with in-memory TTL map"
```

---

### Task 6: JSON State Store (TDD)

**Files:**
- Create: `src/store/json-store.ts`
- Create: `tests/unit/json-store.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/json-store.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/json-store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement JSON store**

Create `src/store/json-store.ts`:

```typescript
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { PancakeState, PancakeEvent, ProcessingStatus, EventRecord, AgentResult } from "../types";

const DEFAULT_STATE: PancakeState = {
  processedIds: [],
  events: [],
  stats: { totalReceived: 0, totalTriggered: 0, totalFailed: 0, lastEventAt: null },
};

const MAX_EVENTS = 200;
const MAX_PROCESSED_IDS = 1000;

export function createJsonStore(filePath: string) {
  async function loadState(): Promise<PancakeState> {
    try {
      const raw = await readFile(filePath, "utf8");
      return { ...DEFAULT_STATE, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_STATE, processedIds: [], events: [], stats: { ...DEFAULT_STATE.stats } };
    }
  }

  async function saveState(state: PancakeState): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(state, null, 2));
  }

  async function saveEvent(event: PancakeEvent): Promise<void> {
    const state = await loadState();
    const record: EventRecord = {
      deliveryId: event.deliveryId,
      event,
      processingStatus: "received",
      receivedAt: new Date().toISOString(),
    };
    state.events.push(record);
    if (state.events.length > MAX_EVENTS) {
      state.events = state.events.slice(-MAX_EVENTS);
    }
    state.stats.totalReceived++;
    state.stats.lastEventAt = new Date().toISOString();
    await saveState(state);
  }

  async function updateEventStatus(
    deliveryId: string,
    status: ProcessingStatus,
    extra?: { agentResult?: AgentResult },
  ): Promise<void> {
    const state = await loadState();
    const record = state.events.find((e) => e.deliveryId === deliveryId);
    if (record) {
      record.processingStatus = status;
      record.processedAt = new Date().toISOString();
      if (extra?.agentResult) record.agentResult = extra.agentResult;
    }
    if (status === "agent_triggered") state.stats.totalTriggered++;
    if (status === "agent_failed") state.stats.totalFailed++;
    await saveState(state);
  }

  async function addProcessedId(deliveryId: string): Promise<void> {
    const state = await loadState();
    state.processedIds.push(deliveryId);
    if (state.processedIds.length > MAX_PROCESSED_IDS) {
      state.processedIds = state.processedIds.slice(-500);
    }
    await saveState(state);
  }

  async function hasProcessedId(deliveryId: string): Promise<boolean> {
    const state = await loadState();
    return state.processedIds.includes(deliveryId);
  }

  return { loadState, saveState, saveEvent, updateEventStatus, addProcessedId, hasProcessedId };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/json-store.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/json-store.ts tests/unit/json-store.test.ts
git commit -m "feat: add JSON file state store with event persistence"
```

---

### Task 7: Prompt Builder (TDD)

**Files:**
- Create: `src/agent/prompt-builder.ts`
- Create: `tests/unit/prompt-builder.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/prompt-builder.test.ts`:

```typescript
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
  it("includes event label, amount, product, and masked email", () => {
    const prompt = buildPrompt(makeEvent());
    expect(prompt).toContain("订单完成");
    expect(prompt).toContain("Notion Template Pro");
    expect(prompt).toContain("29.00 USD");
    expect(prompt).toContain("ali***@example.com");
    expect(prompt).not.toContain("alice@example.com");
  });

  it("prefixes [TEST] for test mode events", () => {
    const prompt = buildPrompt(makeEvent({ mode: "test" }));
    expect(prompt).toContain("[TEST]");
  });

  it("does not prefix [TEST] for prod mode events", () => {
    const prompt = buildPrompt(makeEvent({ mode: "prod" }));
    expect(prompt).not.toContain("[TEST]");
  });

  it("includes the event ID and delivery ID", () => {
    const prompt = buildPrompt(makeEvent());
    expect(prompt).toContain("PAY_p1");
    expect(prompt).toContain("whd_p1");
  });

  it("handles subscription.past_due event", () => {
    const prompt = buildPrompt(makeEvent({
      originalType: "subscription.past_due",
      category: "subscription",
      status: "failed",
    }));
    expect(prompt).toContain("订阅欠费");
    expect(prompt).toContain("failed");
  });

  it("masks short emails correctly", () => {
    const prompt = buildPrompt(makeEvent({
      summary: { ...makeEvent().summary, buyerEmail: "ab@test.com" },
    }));
    expect(prompt).toContain("a***@test.com");
    expect(prompt).not.toContain("ab@test.com");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/prompt-builder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement prompt builder**

Create `src/agent/prompt-builder.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/prompt-builder.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/prompt-builder.ts tests/unit/prompt-builder.test.ts
git commit -m "feat: add prompt builder with event labels and email masking"
```

---

### Task 8: Agent Trigger

**Files:**
- Create: `src/agent/trigger.ts`

- [ ] **Step 1: Implement agent trigger**

Create `src/agent/trigger.ts`:

```typescript
import { buildPrompt } from "./prompt-builder";
import { logger } from "../utils/logger";
import type { PancakeEvent, AgentResult } from "../types";

/**
 * Trigger OpenClaw Agent with a payment event.
 * Uses runEmbeddedPiAgent() — same pattern as the Linear plugin.
 * Agent handles notification delivery and language.
 *
 * @param api - OpenClawPluginApi instance (passed from register())
 * @param event - Normalized Pancake event
 */
export async function triggerAgent(
  api: { runtime: { agent: { runEmbeddedPiAgent: (opts: { sessionId: string; prompt: string }) => Promise<unknown> } } },
  event: PancakeEvent,
): Promise<AgentResult> {
  const prompt = buildPrompt(event);
  const sessionId = `pancake-${event.storeId}-${event.mode}`;

  logger.info(`Triggering agent for ${event.deliveryId} (session: ${sessionId})`);

  try {
    await api.runtime.agent.runEmbeddedPiAgent({ sessionId, prompt });
    logger.info(`Agent triggered successfully for ${event.deliveryId}`);
    return { success: true, sessionId };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error(`Agent trigger failed for ${event.deliveryId}: ${error}`);
    return { success: false, error };
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/agent/trigger.ts
git commit -m "feat: add agent trigger via runEmbeddedPiAgent"
```

---

### Task 9: Signature Verification Wrapper

**Files:**
- Create: `src/processors/signature.ts`

- [ ] **Step 1: Implement signature wrapper**

Create `src/processors/signature.ts`:

```typescript
import { logger } from "../utils/logger";

/**
 * Verify Pancake webhook signature.
 *
 * Delegates to @waffo/pancake-ts SDK's verifyWebhook() which:
 * - Parses X-Waffo-Signature header (t=<timestamp>,v1=<base64>)
 * - Verifies RSA-SHA256(timestamp.body) against built-in public key
 * - Checks 5-minute replay window
 *
 * If the SDK is not available (dev/test), logs a warning and returns true.
 */
export function verifyWebhookSignature(
  body: string,
  signatureHeader: string | undefined,
  mode: "test" | "prod",
): boolean {
  if (!signatureHeader) {
    logger.warn("Missing X-Waffo-Signature header");
    return false;
  }

  try {
    // Dynamic import to handle cases where SDK is not installed
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { verifyWebhook } = require("@waffo/pancake-ts");
    return verifyWebhook(body, signatureHeader, mode);
  } catch {
    logger.warn("@waffo/pancake-ts not available, skipping signature verification");
    return true;
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/processors/signature.ts
git commit -m "feat: add webhook signature verification wrapper"
```

---

### Task 10: Webhook HTTP Route

**Files:**
- Create: `src/routes/webhook.ts`

- [ ] **Step 1: Implement webhook handler**

Create `src/routes/webhook.ts`:

```typescript
import type { IncomingMessage, ServerResponse } from "node:http";
import { verifyWebhookSignature } from "../processors/signature";
import { checkIdempotency, markProcessed } from "../processors/idempotency";
import { normalizeEvent } from "../processors/normalizer";
import { triggerAgent } from "../agent/trigger";
import { logger } from "../utils/logger";
import type { PancakeWebhookPayload } from "../types";
import type { JsonStore } from "../store/json-store";

export function createWebhookHandler(
  api: { runtime: { agent: { runEmbeddedPiAgent: (opts: { sessionId: string; prompt: string }) => Promise<unknown> } } },
  store: JsonStore,
) {
  return async function handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Read body
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");

    let payload: PancakeWebhookPayload;
    try {
      payload = JSON.parse(body);
    } catch {
      logger.warn("Invalid JSON in webhook body");
      res.writeHead(400);
      res.end("Bad Request");
      return;
    }

    // Step 1: Signature verification
    const signatureHeader = req.headers["x-waffo-signature"] as string | undefined;
    if (!verifyWebhookSignature(body, signatureHeader, payload.mode)) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }

    // Step 2: Idempotency check (memory)
    if (await checkIdempotency(payload.id)) {
      logger.info(`Duplicate delivery ignored: ${payload.id}`);
      res.writeHead(200);
      res.end("OK");
      return;
    }

    // Also check persisted IDs (survives restart)
    if (await store.hasProcessedId(payload.id)) {
      logger.info(`Duplicate delivery ignored (persisted): ${payload.id}`);
      await markProcessed(payload.id); // sync to memory
      res.writeHead(200);
      res.end("OK");
      return;
    }

    // Step 3: Normalize
    const event = normalizeEvent(payload);

    // Step 4: Persist
    await store.saveEvent(event);
    await markProcessed(payload.id);
    await store.addProcessedId(payload.id);

    // Step 5: Respond immediately
    res.writeHead(200);
    res.end("OK");

    // Step 6: Trigger agent (async, don't block response)
    try {
      const result = await triggerAgent(api, event);
      await store.updateEventStatus(event.deliveryId, result.success ? "agent_triggered" : "agent_failed", {
        agentResult: result,
      });
    } catch (err) {
      logger.error(`Agent trigger failed for ${event.deliveryId}:`, err);
      await store.updateEventStatus(event.deliveryId, "agent_failed", {
        agentResult: { success: false, error: String(err) },
      });
    }
  };
}
```

- [ ] **Step 2: Update json-store.ts to export the type**

Add to the end of `src/store/json-store.ts`:

```typescript
export type JsonStore = ReturnType<typeof createJsonStore>;
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/routes/webhook.ts src/store/json-store.ts
git commit -m "feat: add webhook HTTP route handler with full pipeline"
```

---

### Task 11: Tools

**Files:**
- Create: `src/tools/query-events.ts`
- Create: `src/tools/query-status.ts`
- Create: `src/tools/retry-event.ts`

- [ ] **Step 1: Create query-events tool**

Create `src/tools/query-events.ts`:

```typescript
import type { JsonStore } from "../store/json-store";

export function createQueryEventsTool(store: JsonStore) {
  return {
    name: "pancake_query_events",
    description: "查询 Pancake 最近的支付/订阅/退款事件",
    parameters: {
      type: "object" as const,
      properties: {
        limit: { type: "number" as const, description: "返回数量 (默认 10, 最大 50)" },
        category: { type: "string" as const, enum: ["payment", "subscription", "refund"] },
        status: { type: "string" as const, enum: ["success", "failed", "pending", "canceled"] },
      },
    },
    handler: async (params: { limit?: number; category?: string; status?: string }) => {
      const state = await store.loadState();
      let events = state.events;
      if (params.category) events = events.filter((e) => e.event.category === params.category);
      if (params.status) events = events.filter((e) => e.event.status === params.status);
      const limit = Math.min(params.limit ?? 10, 50);
      return events.slice(-limit);
    },
  };
}
```

- [ ] **Step 2: Create query-status tool**

Create `src/tools/query-status.ts`:

```typescript
import type { JsonStore } from "../store/json-store";

export function createQueryStatusTool(store: JsonStore) {
  return {
    name: "pancake_status",
    description: "查询 Pancake 插件运行状态和统计",
    parameters: { type: "object" as const, properties: {} },
    handler: async () => {
      const state = await store.loadState();
      return {
        totalReceived: state.stats.totalReceived,
        totalTriggered: state.stats.totalTriggered,
        totalFailed: state.stats.totalFailed,
        lastEventAt: state.stats.lastEventAt,
        recentFailures: state.events
          .filter((e) => e.processingStatus === "agent_failed")
          .slice(-5),
      };
    },
  };
}
```

- [ ] **Step 3: Create retry-event tool**

Create `src/tools/retry-event.ts`:

```typescript
import { triggerAgent } from "../agent/trigger";
import type { JsonStore } from "../store/json-store";

export function createRetryEventTool(
  api: { runtime: { agent: { runEmbeddedPiAgent: (opts: { sessionId: string; prompt: string }) => Promise<unknown> } } },
  store: JsonStore,
) {
  return {
    name: "pancake_retry_event",
    description: "手动重试失败的 Pancake 事件",
    parameters: {
      type: "object" as const,
      properties: {
        deliveryId: { type: "string" as const, description: "交付记录 ID (whd_xxx)" },
      },
      required: ["deliveryId"],
    },
    handler: async (params: { deliveryId: string }) => {
      const state = await store.loadState();
      const record = state.events.find((e) => e.deliveryId === params.deliveryId);
      if (!record) return { error: "Event not found" };
      const result = await triggerAgent(api, record.event);
      await store.updateEventStatus(params.deliveryId, result.success ? "agent_triggered" : "agent_failed", {
        agentResult: result,
      });
      return { success: result.success, ...result };
    },
  };
}
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/tools/query-events.ts src/tools/query-status.ts src/tools/retry-event.ts
git commit -m "feat: add query-events, query-status, and retry-event tools"
```

---

### Task 12: Plugin Entry Point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement plugin entry**

Create `src/index.ts`:

```typescript
import { join } from "node:path";
import { homedir } from "node:os";
import { createWebhookHandler } from "./routes/webhook";
import { createQueryEventsTool } from "./tools/query-events";
import { createQueryStatusTool } from "./tools/query-status";
import { createRetryEventTool } from "./tools/retry-event";
import { createJsonStore } from "./store/json-store";
import { pluginConfigSchema } from "./config";
import { logger } from "./utils/logger";

const STATE_FILE = join(homedir(), ".openclaw", "pancake-state.json");

export default {
  id: "@waffo/pancake",
  name: "Pancake Webhook",
  description: "接收 Pancake 支付事件，触发 OpenClaw Agent 自动通知与交付",
  configSchema: pluginConfigSchema,

  register: (api: any) => {
    const store = createJsonStore(STATE_FILE);

    // HTTP Route: receive Pancake webhooks
    const handleWebhook = createWebhookHandler(api, store);
    api.registerHttpRoute({
      path: "/pancake/webhook",
      auth: "plugin",
      match: "exact",
      handler: (req: any, res: any) => handleWebhook(req, res),
    });

    // Tools: agent-callable
    api.registerTool(createQueryEventsTool(store));
    api.registerTool(createQueryStatusTool(store));
    api.registerTool(createRetryEventTool(api, store));

    logger.info("Pancake plugin registered — webhook at /pancake/webhook");
  },
};
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `dist/` directory created with compiled JS + type declarations

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add plugin entry point with route, tools, and store wiring"
```

---

### Task 13: Integration Test

**Files:**
- Create: `tests/integration/webhook-flow.test.ts`

- [ ] **Step 1: Write integration test**

Create `tests/integration/webhook-flow.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

    // 1. Idempotency: first time should pass
    expect(await checkIdempotency(payload.id)).toBe(false);

    // 2. Normalize
    const event = normalizeEvent(payload);
    expect(event.category).toBe("payment");
    expect(event.status).toBe("success");
    expect(event.summary.productName).toBe("Design Kit");

    // 3. Persist
    await store.saveEvent(event);
    await markProcessed(payload.id);
    await store.addProcessedId(payload.id);

    // 4. Build prompt
    const prompt = buildPrompt(event);
    expect(prompt).toContain("[TEST]");
    expect(prompt).toContain("Design Kit");
    expect(prompt).toContain("49.00 USD");

    // 5. Verify state was persisted
    const state = await store.loadState();
    expect(state.events).toHaveLength(1);
    expect(state.processedIds).toContain("whd_integ_1");
    expect(state.stats.totalReceived).toBe(1);

    // 6. Idempotency: second time should be blocked
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
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS (normalizer: 9, idempotency: 3, json-store: 5, prompt-builder: 6, integration: 2 = 25 total)

- [ ] **Step 3: Commit**

```bash
git add tests/integration/webhook-flow.test.ts
git commit -m "test: add integration test for full webhook processing pipeline"
```

---

### Task 14: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README**

Create `README.md`:

```markdown
# @waffo/pancake

OpenClaw plugin for Pancake payment webhook events. Receives payment, subscription, and refund events from the Pancake platform and triggers the OpenClaw Agent to notify merchants via their connected IM channels (WeChat, Telegram, Lark, Feishu, etc.).

## Install

```bash
openclaw plugins install @waffo/pancake
```

## Setup

1. Install the plugin in OpenClaw
2. Get your webhook URL: `https://your-openclaw-host/pancake/webhook`
3. In Pancake Dashboard → Settings → Webhooks, add the URL and select events
4. Done — the Agent will notify you on your connected channels when events occur

## Supported Events

| Event | Description |
|-------|-------------|
| `order.completed` | One-time payment succeeded |
| `subscription.activated` | New subscription activated |
| `subscription.payment_succeeded` | Subscription renewal succeeded |
| `subscription.updated` | Subscription details changed |
| `subscription.canceling` | Subscription will cancel at period end |
| `subscription.uncanceled` | Cancellation reversed |
| `subscription.canceled` | Subscription canceled |
| `subscription.past_due` | Subscription payment failed |
| `refund.succeeded` | Refund completed |
| `refund.failed` | Refund failed |

## Agent Tools

- `pancake_query_events` — Query recent payment/subscription/refund events
- `pancake_status` — Plugin status and statistics
- `pancake_retry_event` — Retry a failed event

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `mode` | `test` | Pancake environment (`test` or `prod`) |
| `logLevel` | `info` | Log level (`debug`, `info`, `warn`, `error`) |

## Development

```bash
npm install
npm test          # run tests
npm run build     # compile TypeScript
```
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with install, setup, and usage instructions"
```

---

### Task 15: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All 25 tests PASS

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: Clean build, `dist/` contains all compiled files

- [ ] **Step 3: Check TypeScript**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Verify file structure matches spec**

Run: `find src -type f | sort`
Expected output:
```
src/agent/prompt-builder.ts
src/agent/trigger.ts
src/config.ts
src/index.ts
src/processors/idempotency.ts
src/processors/normalizer.ts
src/processors/signature.ts
src/routes/webhook.ts
src/store/json-store.ts
src/tools/query-events.ts
src/tools/query-status.ts
src/tools/retry-event.ts
src/types.ts
src/utils/logger.ts
```

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: verify build and test suite pass"
```
