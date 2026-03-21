import Cloudflare from "cloudflare";
import type { QueryResult } from "cloudflare/resources/d1/database.js";
import { getConfig } from "./config.js";

export interface Job {
  company: string;
  crawled_at: string;
  deadline: string;
  description: string;
  employment_type: string;
  fingerprint: string;
  id?: number;
  language_flag: string;
  language_required: string;
  location: string;
  platform: string;
  posted_at: string;
  relevance_reason: string;
  relevance_score: number | null;
  salary: string;
  sent: number;
  title: string;
  title_en: string;
  url: string;
}

let _client: Cloudflare | null = null;

function getClient(): Cloudflare {
  if (!_client) {
    _client = new Cloudflare({ apiToken: getConfig().cloudflareApiToken });
  }
  return _client;
}

async function queryD1(
  sql: string,
  params: string[] = []
): Promise<QueryResult> {
  const { cloudflareAccountId, d1DatabaseId } = getConfig();
  const page = await getClient().d1.database.query(d1DatabaseId, {
    account_id: cloudflareAccountId,
    sql,
    params,
  });
  return page.result[0];
}

async function queryRows<T>(sql: string, params: string[] = []): Promise<T[]> {
  const result = await queryD1(sql, params);
  return (result.results ?? []) as T[];
}

async function execute(sql: string, params: string[] = []): Promise<number> {
  const result = await queryD1(sql, params);
  return result.meta?.changes ?? 0;
}

let _schemaReady = false;

async function ensureSchema(): Promise<void> {
  if (_schemaReady) {
    return;
  }
  await queryD1(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      title_en TEXT NOT NULL DEFAULT '',
      company TEXT NOT NULL,
      url TEXT NOT NULL,
      platform TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT '',
      employment_type TEXT NOT NULL DEFAULT 'unknown',
      language_required TEXT NOT NULL DEFAULT 'unclear',
      description TEXT NOT NULL DEFAULT '',
      salary TEXT NOT NULL DEFAULT '',
      deadline TEXT NOT NULL DEFAULT '',
      posted_at TEXT NOT NULL DEFAULT '',
      crawled_at TEXT NOT NULL DEFAULT (datetime('now')),
      relevance_score INTEGER,
      relevance_reason TEXT NOT NULL DEFAULT '',
      language_flag TEXT NOT NULL DEFAULT '',
      sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  _schemaReady = true;
}

export async function insertJob(
  job: Omit<
    Job,
    "id" | "relevance_score" | "relevance_reason" | "language_flag" | "sent"
  >
): Promise<boolean> {
  await ensureSchema();
  const changes = await execute(
    `INSERT OR IGNORE INTO jobs (fingerprint, title, title_en, company, url, platform, location, employment_type, language_required, description, salary, deadline, posted_at, crawled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      job.fingerprint,
      job.title,
      job.title_en,
      job.company,
      job.url,
      job.platform,
      job.location,
      job.employment_type,
      job.language_required,
      job.description,
      job.salary,
      job.deadline,
      job.posted_at,
      job.crawled_at,
    ]
  );
  return changes > 0;
}

export async function getUnsentJobs(): Promise<Job[]> {
  await ensureSchema();
  return queryRows<Job>("SELECT * FROM jobs WHERE sent = 0");
}

export async function getUnscoredJobs(): Promise<Job[]> {
  await ensureSchema();
  return queryRows<Job>(
    "SELECT * FROM jobs WHERE sent = 0 AND relevance_score IS NULL"
  );
}

export async function expireJobs(): Promise<number> {
  await ensureSchema();
  return execute(
    "UPDATE jobs SET sent = 1 WHERE (deadline = 'expired' OR (deadline != '' AND deadline < date('now'))) AND sent = 0"
  );
}

export async function updateScore(
  id: number,
  score: number,
  reason: string,
  flag: string
): Promise<void> {
  await ensureSchema();
  await execute(
    "UPDATE jobs SET relevance_score = ?, relevance_reason = ?, language_flag = ? WHERE id = ?",
    [String(score), reason, flag, String(id)]
  );
}

export async function suppressLowScoring(threshold: number): Promise<number> {
  await ensureSchema();
  return execute(
    "UPDATE jobs SET sent = 1 WHERE relevance_score IS NOT NULL AND relevance_score < ? AND sent = 0",
    [String(threshold)]
  );
}

export async function getScoredUnsentJobs(): Promise<Job[]> {
  await ensureSchema();
  return queryRows<Job>(
    "SELECT * FROM jobs WHERE sent = 0 AND relevance_score IS NOT NULL ORDER BY relevance_score DESC"
  );
}

export async function markSent(ids: number[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await ensureSchema();
  const placeholders = ids.map(() => "?").join(",");
  await execute(
    `UPDATE jobs SET sent = 1 WHERE id IN (${placeholders})`,
    ids.map(String)
  );
}

export async function getAllUrls(): Promise<string[]> {
  await ensureSchema();
  const rows = await queryRows<{ url: string }>("SELECT url FROM jobs");
  return rows.map((r) => r.url);
}
