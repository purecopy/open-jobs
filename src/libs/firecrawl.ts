import FirecrawlApp from "@mendable/firecrawl-js";
import { getConfig } from "../config.js";

let _client: FirecrawlApp | null = null;

export function getFirecrawlClient(): FirecrawlApp {
  if (!_client) {
    _client = new FirecrawlApp({ apiKey: getConfig().firecrawlApiKey });
  }
  return _client;
}

const RESETS_AT_RE = /resets at (.+?)(?:\s*\(|$)/;

export function isRateLimitError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("Rate limit");
}

export function getResetDelay(err: unknown): number | null {
  if (!(err instanceof Error)) {
    return null;
  }
  const match = err.message.match(RESETS_AT_RE);
  if (!match) {
    return null;
  }
  const resetMs = new Date(match[1]).getTime() - Date.now();
  // Add 1s buffer; ignore if the reset time is in the past or unparseable
  return resetMs > 0 ? resetMs + 1000 : null;
}
