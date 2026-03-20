import dotenv from "dotenv";
import { readFileSync } from "fs";
import { resolve } from "path";

dotenv.config();

export interface Profile {
  name: string;
  location: { preferred: string[]; remote_ok: boolean };
  roles: string[];
  employment_type: string[];
  languages: { spoken: string[]; scoring_note: string };
  experience_summary: string;
  strengths: string[];
  dealbreakers: string[];
  nice_to_have: string[];
}

export interface Config {
  anthropicApiKey: string;
  firecrawlApiKey: string;
  perplexityApiKey: string;
  dbPath: string;
  relevanceThreshold: number;
  profile: Profile;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
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
      dbPath: process.env.OPENCLAW_DB_PATH || "./openclaw.db",
      relevanceThreshold: parseInt(process.env.RELEVANCE_THRESHOLD || "3", 10),
      profile: loadProfile(),
    };
  }
  return _config;
}
