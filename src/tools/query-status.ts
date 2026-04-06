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
