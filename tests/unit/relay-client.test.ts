import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRelayClient } from "../../src/relay/client";

describe("RelayClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns permanent webhook URL based on pluginId", () => {
    const client = createRelayClient("test-uuid-123");
    expect(client.getWebhookUrl()).toBe("https://relay.waffo.ai/webhook/test-uuid-123");
    expect(client.getPluginId()).toBe("test-uuid-123");
  });

  it("registers target URL with relay service", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const client = createRelayClient("test-uuid-123");
    const result = await client.register("https://abc.trycloudflare.com");

    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith("https://relay.waffo.ai/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pluginId: "test-uuid-123",
        targetUrl: "https://abc.trycloudflare.com",
      }),
    });
  });

  it("returns false when relay is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    const client = createRelayClient("test-uuid-123");
    const result = await client.register("https://abc.trycloudflare.com");

    expect(result).toBe(false);
  });

  it("returns false on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("error", { status: 500 }),
    );

    const client = createRelayClient("test-uuid-123");
    const result = await client.register("https://abc.trycloudflare.com");

    expect(result).toBe(false);
  });
});
