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
