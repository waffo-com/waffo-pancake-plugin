import { z } from "zod";

export const pluginConfigSchema = z.object({
  mode: z.enum(["test", "prod"]).default("test"),
  agentId: z.string().optional(),
  notifyTarget: z.object({
    channel: z.string(),
    to: z.string(),
  }).optional(),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  tunnel: z.object({
    enabled: z.boolean().default(true),
    type: z.enum(["quick", "named"]).default("quick"),
    namedTunnelToken: z.string().optional(),
    port: z.number().default(18789),
  }).default({}),
});

export type PancakePluginConfig = z.infer<typeof pluginConfigSchema>;
