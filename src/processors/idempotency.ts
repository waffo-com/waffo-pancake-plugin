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

export function resetForTesting(): void {
  processedIds.clear();
}
