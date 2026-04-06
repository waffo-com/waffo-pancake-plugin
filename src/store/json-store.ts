import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { PancakeState, PancakeEvent, ProcessingStatus, EventRecord, AgentResult } from "../types";

const MAX_EVENTS = 200;
const MAX_PROCESSED_IDS = 1000;

function defaultState(): PancakeState {
  return {
    processedIds: [],
    events: [],
    stats: { totalReceived: 0, totalTriggered: 0, totalFailed: 0, lastEventAt: null },
  };
}

export function createJsonStore(filePath: string) {
  async function loadState(): Promise<PancakeState> {
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      return { ...defaultState(), ...parsed };
    } catch {
      return defaultState();
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
    const updatedEvents = [...state.events, record];
    const cappedEvents = updatedEvents.length > MAX_EVENTS
      ? updatedEvents.slice(-MAX_EVENTS)
      : updatedEvents;
    const updatedState: PancakeState = {
      ...state,
      events: cappedEvents,
      stats: {
        ...state.stats,
        totalReceived: state.stats.totalReceived + 1,
        lastEventAt: new Date().toISOString(),
      },
    };
    await saveState(updatedState);
  }

  async function updateEventStatus(
    deliveryId: string,
    status: ProcessingStatus,
    extra?: { agentResult?: AgentResult },
  ): Promise<void> {
    const state = await loadState();
    const updatedEvents = state.events.map((record) => {
      if (record.deliveryId !== deliveryId) return record;
      return {
        ...record,
        processingStatus: status,
        processedAt: new Date().toISOString(),
        ...(extra?.agentResult ? { agentResult: extra.agentResult } : {}),
      };
    });
    const updatedState: PancakeState = {
      ...state,
      events: updatedEvents,
      stats: {
        ...state.stats,
        totalTriggered: status === "agent_triggered"
          ? state.stats.totalTriggered + 1
          : state.stats.totalTriggered,
        totalFailed: status === "agent_failed"
          ? state.stats.totalFailed + 1
          : state.stats.totalFailed,
      },
    };
    await saveState(updatedState);
  }

  async function addProcessedId(deliveryId: string): Promise<void> {
    const state = await loadState();
    const updatedIds = [...state.processedIds, deliveryId];
    const cappedIds = updatedIds.length > MAX_PROCESSED_IDS
      ? updatedIds.slice(-500)
      : updatedIds;
    await saveState({ ...state, processedIds: cappedIds });
  }

  async function hasProcessedId(deliveryId: string): Promise<boolean> {
    const state = await loadState();
    return state.processedIds.includes(deliveryId);
  }

  return { loadState, saveState, saveEvent, updateEventStatus, addProcessedId, hasProcessedId };
}

export type JsonStore = ReturnType<typeof createJsonStore>;
