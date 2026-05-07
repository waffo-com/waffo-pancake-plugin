import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
    manager.stop();
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

// New tests use the dependency injection API (third arg) for full control over
// tunnel lifecycle and health checks. These do not depend on the cloudflared mock above.
describe("TunnelManager — supervised reconnect", () => {
  let closeHandlers: Array<(code: number | null) => void>;

  function makeStartFn(urls: string[]) {
    let i = 0;
    return vi.fn(async () => {
      const url = urls[Math.min(i++, urls.length - 1)];
      return {
        url,
        stop: vi.fn(),
        onClose: vi.fn((h: (code: number | null) => void) => {
          closeHandlers.push(h);
        }),
      };
    });
  }

  beforeEach(() => {
    closeHandlers = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-registers via onUrlChange when cloudflared exits unexpectedly", async () => {
    vi.useFakeTimers();
    const onUrlChange = vi.fn();
    const startQuickTunnelFn = makeStartFn([
      "https://first.trycloudflare.com",
      "https://second.trycloudflare.com",
    ]);

    const manager = createTunnelManager(
      { enabled: true, type: "quick", port: 18789 },
      { onUrlChange },
      {
        startQuickTunnelFn,
        reconnectInitialBackoffMs: 100,
        healthCheckIntervalMs: 999_999,
      },
    );

    const initial = await manager.start();
    expect(initial).toBe("https://first.trycloudflare.com");
    expect(onUrlChange).not.toHaveBeenCalled();

    // simulate cloudflared crash
    closeHandlers[0](1);

    // advance through backoff + microtasks
    await vi.advanceTimersByTimeAsync(150);

    expect(startQuickTunnelFn).toHaveBeenCalledTimes(2);
    expect(manager.getUrl()).toBe("https://second.trycloudflare.com");
    expect(onUrlChange).toHaveBeenCalledTimes(1);
    expect(onUrlChange).toHaveBeenCalledWith("https://second.trycloudflare.com");

    manager.stop();
  });

  it("forces reconnect when DNS health check fails", async () => {
    vi.useFakeTimers();
    const onUrlChange = vi.fn();
    const healthCheck = vi.fn().mockResolvedValue(false);
    const startQuickTunnelFn = makeStartFn([
      "https://alive.trycloudflare.com",
      "https://recovered.trycloudflare.com",
    ]);

    const manager = createTunnelManager(
      { enabled: true, type: "quick", port: 18789 },
      { onUrlChange },
      {
        startQuickTunnelFn,
        reconnectInitialBackoffMs: 100,
        healthCheckIntervalMs: 1_000,
        healthCheck,
      },
    );

    await manager.start();
    expect(manager.getUrl()).toBe("https://alive.trycloudflare.com");

    // trigger one health check tick
    await vi.advanceTimersByTimeAsync(1_000);
    // let DNS promise resolve and reconnect kick in
    await vi.advanceTimersByTimeAsync(150);

    expect(healthCheck).toHaveBeenCalledWith("alive.trycloudflare.com");
    expect(startQuickTunnelFn).toHaveBeenCalledTimes(2);
    expect(manager.getUrl()).toBe("https://recovered.trycloudflare.com");
    expect(onUrlChange).toHaveBeenCalledWith("https://recovered.trycloudflare.com");

    manager.stop();
  });

  it("stop() prevents reconnect after close event", async () => {
    vi.useFakeTimers();
    const onUrlChange = vi.fn();
    const startQuickTunnelFn = makeStartFn([
      "https://only.trycloudflare.com",
      "https://should-never-start.trycloudflare.com",
    ]);

    const manager = createTunnelManager(
      { enabled: true, type: "quick", port: 18789 },
      { onUrlChange },
      {
        startQuickTunnelFn,
        reconnectInitialBackoffMs: 100,
        healthCheckIntervalMs: 999_999,
      },
    );

    await manager.start();
    manager.stop();
    closeHandlers[0](0);

    await vi.advanceTimersByTimeAsync(500);

    expect(startQuickTunnelFn).toHaveBeenCalledTimes(1);
    expect(onUrlChange).not.toHaveBeenCalled();
  });

  it("retries with backoff when reconnect attempt fails", async () => {
    vi.useFakeTimers();
    const onUrlChange = vi.fn();
    let calls = 0;
    const startQuickTunnelFn = vi.fn(async () => {
      calls++;
      if (calls === 2) throw new Error("simulated startup failure");
      const result = {
        url: calls === 1 ? "https://first.trycloudflare.com" : "https://third.trycloudflare.com",
        stop: vi.fn(),
        onClose: vi.fn((h: (code: number | null) => void) => {
          closeHandlers.push(h);
        }),
      };
      return result;
    });

    const manager = createTunnelManager(
      { enabled: true, type: "quick", port: 18789 },
      { onUrlChange },
      {
        startQuickTunnelFn,
        reconnectInitialBackoffMs: 100,
        healthCheckIntervalMs: 999_999,
      },
    );

    await manager.start();
    closeHandlers[0](1);

    // first reconnect attempt: 100ms backoff → fails
    await vi.advanceTimersByTimeAsync(150);
    expect(startQuickTunnelFn).toHaveBeenCalledTimes(2);

    // second reconnect attempt: 200ms (exponential) backoff → succeeds
    await vi.advanceTimersByTimeAsync(250);
    expect(startQuickTunnelFn).toHaveBeenCalledTimes(3);
    expect(manager.getUrl()).toBe("https://third.trycloudflare.com");
    expect(onUrlChange).toHaveBeenCalledWith("https://third.trycloudflare.com");

    manager.stop();
  });
});
