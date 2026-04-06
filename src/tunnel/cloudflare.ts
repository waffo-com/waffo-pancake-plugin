import { logger } from "../utils/logger";

interface TunnelResult {
  url: string;
  stop: () => void;
}

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
      t.once("url", (u: string) => resolve(u));
      t.once("error", (err: Error) => reject(err));
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

    // Named tunnels don't emit a URL — wait for first connection
    await new Promise<void>((resolve, reject) => {
      t.once("connected", () => resolve());
      t.once("error", (err: Error) => reject(err));
    });

    logger.info("Named tunnel connections established");

    return {
      url: "(configured domain — see Cloudflare Dashboard)",
      stop: () => {
        logger.info("Stopping named Cloudflare Tunnel...");
        t.stop();
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

/**
 * Create a tunnel manager based on config.
 */
export function createTunnelManager(config: {
  enabled: boolean;
  type: "quick" | "named";
  namedTunnelToken?: string;
  port: number;
}): TunnelManager {
  let currentTunnel: TunnelResult | null = null;
  let publicUrl: string | null = null;

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
        currentTunnel = await startNamedTunnel(config.namedTunnelToken);
        publicUrl = currentTunnel.url;
        return publicUrl;
      }

      // Default: quick tunnel
      currentTunnel = await startQuickTunnel(config.port);
      publicUrl = currentTunnel.url;
      return publicUrl;
    },

    stop() {
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
