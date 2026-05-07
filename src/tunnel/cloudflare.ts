import { lookup as dnsLookup } from "node:dns/promises";
import { logger } from "../utils/logger";

interface TunnelResult {
  url: string;
  stop: () => void;
  onClose: (handler: (code: number | null) => void) => void;
}

const TUNNEL_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 60_000;
const DEFAULT_RECONNECT_INITIAL_BACKOFF_MS = 5_000;
const RECONNECT_MAX_BACKOFF_MS = 300_000;

/**
 * Start a Cloudflare Quick Tunnel (TryCloudflare).
 * - No Cloudflare account needed
 * - Generates a random *.trycloudflare.com URL
 * - URL changes on each restart (suitable for dev/test)
 *
 * Uses the `cloudflared` npm package which auto-downloads
 * the correct binary for the user's platform.
 */
export async function startQuickTunnel(port: number): Promise<TunnelResult> {
  logger.info(`Starting Cloudflare Quick Tunnel for localhost:${port}...`);

  try {
    const { Tunnel } = await import("cloudflared");
    const t = Tunnel.quick(`http://localhost:${port}`);

    const url = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Tunnel startup timed out after 30s"));
      }, TUNNEL_STARTUP_TIMEOUT_MS);

      t.once("url", (u: string) => {
        clearTimeout(timeout);
        resolve(u);
      });

      t.once("error", (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });

      (t as any).once("close", (code: number | null) => {
        clearTimeout(timeout);
        reject(new Error(`cloudflared exited with code ${code} before establishing tunnel`));
      });
    });

    logger.info(`Tunnel active: ${url}`);

    t.once("connected", () => {
      logger.info("Tunnel connections established");
    });

    return {
      url,
      stop: () => {
        logger.info("Stopping Cloudflare Tunnel...");
        t.stop();
      },
      onClose: (handler) => {
        (t as any).once("close", handler);
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to start Cloudflare Tunnel: ${message}`);
    throw new Error(`Tunnel startup failed: ${message}`);
  }
}

/**
 * Start a Named Cloudflare Tunnel (requires Cloudflare account + token).
 * - Stable URL (custom domain)
 * - Suitable for production
 */
export async function startNamedTunnel(token: string): Promise<TunnelResult> {
  logger.info("Starting named Cloudflare Tunnel...");

  try {
    const { Tunnel } = await import("cloudflared");
    const t = Tunnel.withToken(token);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Named tunnel startup timed out after 30s"));
      }, TUNNEL_STARTUP_TIMEOUT_MS);

      t.once("connected", () => {
        clearTimeout(timeout);
        resolve();
      });

      t.once("error", (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });

      (t as any).once("close", (code: number | null) => {
        clearTimeout(timeout);
        reject(new Error(`cloudflared exited with code ${code}`));
      });
    });

    logger.info("Named tunnel connections established");

    return {
      url: "(configured domain — see Cloudflare Dashboard)",
      stop: () => {
        logger.info("Stopping named Cloudflare Tunnel...");
        t.stop();
      },
      onClose: (handler) => {
        (t as any).once("close", handler);
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to start named Cloudflare Tunnel: ${message}`);
    throw new Error(`Named tunnel startup failed: ${message}`);
  }
}

export interface TunnelManager {
  start: () => Promise<string | null>;
  stop: () => void;
  getUrl: () => string | null;
}

export interface TunnelManagerCallbacks {
  /**
   * Fired whenever the tunnel reconnects with a new URL — i.e., not on the
   * initial start (the caller already has that URL via the start() return value),
   * but on every subsequent URL change (close → reconnect, or health check → forced reconnect).
   *
   * Use this to re-register the new URL with downstream services like the relay.
   */
  onUrlChange?: (newUrl: string) => void | Promise<void>;
}

export interface TunnelManagerConfig {
  enabled: boolean;
  type: "quick" | "named";
  namedTunnelToken?: string;
  port: number;
}

/** Internal-only options for dependency injection in tests. Not part of public config. */
export interface TunnelManagerInternalOptions {
  healthCheckIntervalMs?: number;
  reconnectInitialBackoffMs?: number;
  /** Returns true if the hostname is healthy (DNS resolves), false otherwise. */
  healthCheck?: (hostname: string) => Promise<boolean>;
  /** Override startQuickTunnel for tests. */
  startQuickTunnelFn?: (port: number) => Promise<TunnelResult>;
  /** Override startNamedTunnel for tests. */
  startNamedTunnelFn?: (token: string) => Promise<TunnelResult>;
}

/**
 * Create a tunnel manager that supervises a Cloudflare Tunnel.
 *
 * For Quick Tunnels (type: "quick") it provides automatic recovery from two failure modes:
 * - cloudflared process exits unexpectedly (handled via close event)
 * - Cloudflare reaps the trycloudflare.com hostname while the process is still alive
 *   (handled via periodic DNS health check)
 *
 * On every successful reconnect the new URL is forwarded via the `onUrlChange` callback
 * so the caller can re-register it with downstream services (e.g., the relay).
 */
export function createTunnelManager(
  config: TunnelManagerConfig,
  callbacks: TunnelManagerCallbacks = {},
  internal: TunnelManagerInternalOptions = {},
): TunnelManager {
  const healthCheckIntervalMs = internal.healthCheckIntervalMs ?? DEFAULT_HEALTH_CHECK_INTERVAL_MS;
  const reconnectInitialBackoffMs = internal.reconnectInitialBackoffMs ?? DEFAULT_RECONNECT_INITIAL_BACKOFF_MS;
  const healthCheck = internal.healthCheck ?? defaultHealthCheck;
  const startQuick = internal.startQuickTunnelFn ?? startQuickTunnel;
  const startNamed = internal.startNamedTunnelFn ?? startNamedTunnel;

  let currentTunnel: TunnelResult | null = null;
  let publicUrl: string | null = null;
  let stopped = false;
  let healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectAttempt = 0;
  let reconnecting = false;

  function clearHealthCheck() {
    if (healthCheckTimer) {
      clearInterval(healthCheckTimer);
      healthCheckTimer = null;
    }
  }

  function startHealthCheck() {
    if (config.type !== "quick") return;
    clearHealthCheck();
    healthCheckTimer = setInterval(() => {
      if (stopped || !publicUrl) return;
      const hostname = safeHostname(publicUrl);
      if (!hostname) return;
      healthCheck(hostname)
        .then((ok) => {
          if (stopped) return;
          if (!ok) {
            logger.warn(`Tunnel health check failed for ${hostname} — forcing reconnect`);
            scheduleReconnect("health check failed");
          }
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(`Health check error: ${message}`);
        });
    }, healthCheckIntervalMs);
    if (typeof healthCheckTimer.unref === "function") healthCheckTimer.unref();
  }

  function attachCloseHandler(tunnel: TunnelResult) {
    tunnel.onClose((code: number | null) => {
      if (stopped) return;
      logger.warn(`Tunnel process exited unexpectedly (code ${code})`);
      scheduleReconnect("close event");
    });
  }

  function scheduleReconnect(reason: string) {
    if (stopped || reconnecting) return;
    reconnecting = true;
    void reconnect(reason).finally(() => {
      reconnecting = false;
    });
  }

  async function reconnect(reason: string): Promise<void> {
    if (stopped) return;

    clearHealthCheck();
    if (currentTunnel) {
      try {
        currentTunnel.stop();
      } catch {
        // best-effort cleanup
      }
      currentTunnel = null;
    }

    const backoff = Math.min(
      reconnectInitialBackoffMs * Math.pow(2, reconnectAttempt),
      RECONNECT_MAX_BACKOFF_MS,
    );
    reconnectAttempt++;
    logger.warn(`Tunnel reconnect (${reason}) in ${backoff / 1000}s (attempt ${reconnectAttempt})`);

    await delay(backoff);
    if (stopped) return;

    try {
      const newTunnel = await startQuick(config.port);
      if (stopped) {
        try { newTunnel.stop(); } catch { /* ignore */ }
        return;
      }
      attachCloseHandler(newTunnel);
      currentTunnel = newTunnel;
      publicUrl = newTunnel.url;
      reconnectAttempt = 0;
      startHealthCheck();
      try {
        await callbacks.onUrlChange?.(newTunnel.url);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`onUrlChange callback failed: ${message}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Tunnel reconnect failed: ${message}`);
      reconnecting = false;
      scheduleReconnect("retry after failure");
    }
  }

  return {
    async start(): Promise<string | null> {
      if (!config.enabled) {
        logger.info("Tunnel disabled — ensure OpenClaw is publicly accessible");
        return null;
      }

      if (config.type === "named") {
        if (!config.namedTunnelToken) {
          logger.error("Named tunnel requires namedTunnelToken in config");
          return null;
        }
        currentTunnel = await startNamed(config.namedTunnelToken);
        publicUrl = currentTunnel.url;
        attachCloseHandler(currentTunnel);
        return publicUrl;
      }

      currentTunnel = await startQuick(config.port);
      publicUrl = currentTunnel.url;
      attachCloseHandler(currentTunnel);
      startHealthCheck();
      return publicUrl;
    },

    stop() {
      stopped = true;
      clearHealthCheck();
      if (currentTunnel) {
        currentTunnel.stop();
        currentTunnel = null;
        publicUrl = null;
      }
    },

    getUrl() {
      return publicUrl;
    },
  };
}

async function defaultHealthCheck(hostname: string): Promise<boolean> {
  try {
    await dnsLookup(hostname);
    return true;
  } catch {
    return false;
  }
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === "function") t.unref();
  });
}
