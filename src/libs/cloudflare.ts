import Cloudflare from "cloudflare";
import { getConfig } from "../config.js";

let _client: Cloudflare | null = null;

export function getCloudflareClient(): Cloudflare {
  if (!_client) {
    _client = new Cloudflare({ apiToken: getConfig().cloudflareApiToken });
  }
  return _client;
}
