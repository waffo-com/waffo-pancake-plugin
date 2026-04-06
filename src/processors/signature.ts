import { logger } from "../utils/logger";

export function verifyWebhookSignature(
  body: string,
  signatureHeader: string | undefined,
  mode: "test" | "prod",
): boolean {
  if (!signatureHeader) {
    logger.warn("Missing X-Waffo-Signature header");
    return false;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { verifyWebhook } = require("@waffo/pancake-ts");
    return verifyWebhook(body, signatureHeader, mode);
  } catch {
    logger.warn("@waffo/pancake-ts not available, skipping signature verification");
    return true;
  }
}
