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
      required: ["deliveryId"] as const,
    },
    handler: async (params: { deliveryId: string }) => {
      const state = await store.loadState();
      const record = state.events.find((e) => e.deliveryId === params.deliveryId);
      if (!record) return { error: "Event not found" };
      const result = await triggerAgent(api, record.event);
      await store.updateEventStatus(params.deliveryId, result.success ? "agent_triggered" : "agent_failed", {
        agentResult: result,
      });
      return { ...result };
    },
  };
}
