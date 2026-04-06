import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTunnelManager } from "../../src/tunnel/cloudflare";

// Mock the cloudflared module using the EventEmitter-based Tunnel class
vi.mock("cloudflared", () => {
  const mockStop = vi.fn();

  function makeTunnel(emitUrl: boolean) {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

    const t = {
      stop: mockStop,
      once(event: string, handler: (...args: unknown[]) => void) {
        listeners[event] = listeners[event] ?? [];
        listeners[event].push(handler);
        return t;
      },
      emit(event: string, ...args: unknown[]) {
        (listeners[event] ?? []).forEach((h) => h(...args));
      },
    };

    // Emit asynchronously so the promise has time to attach listeners
    if (emitUrl) {
      setTimeout(() => t.emit("url", "https://test-abc.trycloudflare.com"), 0);
    } else {
      setTimeout(() => t.emit("connected"), 0);
    }

    return t;
  }

  return {
    Tunnel: {
      quick: vi.fn(() => makeTunnel(true)),
      withToken: vi.fn(() => makeTunnel(false)),
    },
  };
});

describe("TunnelManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when tunnel is disabled", async () => {
    const manager = createTunnelManager({
      enabled: false,
      type: "quick",
      port: 18789,
    });
    const url = await manager.start();
    expect(url).toBeNull();
    expect(manager.getUrl()).toBeNull();
  });

  it("starts a quick tunnel and returns URL", async () => {
    const manager = createTunnelManager({
      enabled: true,
      type: "quick",
      port: 18789,
    });
    const url = await manager.start();
    expect(url).toBe("https://test-abc.trycloudflare.com");
    expect(manager.getUrl()).toBe("https://test-abc.trycloudflare.com");
  });

  it("returns null for named tunnel without token", async () => {
    const manager = createTunnelManager({
      enabled: true,
      type: "named",
      port: 18789,
    });
    const url = await manager.start();
    expect(url).toBeNull();
  });

  it("stop clears the URL", async () => {
    const manager = createTunnelManager({
      enabled: true,
      type: "quick",
      port: 18789,
    });
    await manager.start();
    expect(manager.getUrl()).toBe("https://test-abc.trycloudflare.com");
    manager.stop();
    expect(manager.getUrl()).toBeNull();
  });
});
