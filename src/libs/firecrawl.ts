import FirecrawlApp from "@mendable/firecrawl-js";
import { getConfig } from "../config.js";

let _client: FirecrawlApp | null = null;

export function getFirecrawlClient(): FirecrawlApp {
  if (!_client) {
    _client = new FirecrawlApp({ apiKey: getConfig().firecrawlApiKey });
  }
  return _client;
}
