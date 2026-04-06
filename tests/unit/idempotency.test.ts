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
