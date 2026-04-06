export const logger = {
  debug: (...args: unknown[]) => console.debug("[pancake]", ...args),
  info: (...args: unknown[]) => console.info("[pancake]", ...args),
  warn: (...args: unknown[]) => console.warn("[pancake]", ...args),
  error: (...args: unknown[]) => console.error("[pancake]", ...args),
};
