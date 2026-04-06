import { z } from "zod";

export const pluginConfigSchema = z.object({
  mode: z.enum(["test", "prod"]).default("test"),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type PancakePluginConfig = z.infer<typeof pluginConfigSchema>;
