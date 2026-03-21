import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config();

export interface Profile {
  dealbreakers: string[];
  employment_type: string[];
  experience_summary: string;
  languages: { spoken: string[]; scoring_note: string };
  location: { preferred: string[]; remote_ok: boolean };
  name: string;
  nice_to_have: string[];
  roles: string[];
  strengths: string[];
}

export interface Config {
  anthropicApiKey: string;
  cloudflareAccountId: string;
  cloudflareApiToken: string;
  d1DatabaseId: string;
  firecrawlApiKey: string;
  perplexityApiKey: string;
  profile: Profile;
  relevanceThreshold: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function loadProfile(): Profile {
  const profilePath = resolve(process.cwd(), "profile.json");
  const raw = readFileSync(profilePath, "utf-8");
  return JSON.parse(raw) as Profile;
}

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = {
      anthropicApiKey: requireEnv("ANTHROPIC_API_KEY"),
      firecrawlApiKey: requireEnv("FIRECRAWL_API_KEY"),
      perplexityApiKey: requireEnv("PERPLEXITY_API_KEY"),
      cloudflareAccountId: requireEnv("CLOUDFLARE_ACCOUNT_ID"),
      cloudflareApiToken: requireEnv("CLOUDFLARE_API_TOKEN"),
      d1DatabaseId: requireEnv("CLOUDFLARE_D1_DATABASE_ID"),
      relevanceThreshold: Number.parseInt(
        process.env.RELEVANCE_THRESHOLD || "3",
        10
      ),
      profile: loadProfile(),
    };
  }
  return _config;
}
