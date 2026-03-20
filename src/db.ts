import Database from "better-sqlite3";
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

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(getConfig().dbPath);
    _db.pragma("journal_mode = WAL");
    migrate(_db);
  }
  return _db;
}

function migrate(db: Database.Database): void {
  db.exec(`
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
}

export function insertJob(
  job: Omit<
    Job,
    "id" | "relevance_score" | "relevance_reason" | "language_flag" | "sent"
  >
): boolean {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO jobs (fingerprint, title, title_en, company, url, platform, location, employment_type, language_required, description, salary, deadline, posted_at, crawled_at)
    VALUES (@fingerprint, @title, @title_en, @company, @url, @platform, @location, @employment_type, @language_required, @description, @salary, @deadline, @posted_at, @crawled_at)
  `);
  const result = stmt.run(job);
  return result.changes > 0;
}

export function getUnsentJobs(): Job[] {
  const db = getDb();
  return db.prepare("SELECT * FROM jobs WHERE sent = 0").all() as Job[];
}

export function getUnscoredJobs(): Job[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM jobs WHERE sent = 0 AND relevance_score IS NULL")
    .all() as Job[];
}

export function expireJobs(): number {
  const db = getDb();
  const result = db
    .prepare(
      "UPDATE jobs SET sent = 1 WHERE deadline != '' AND deadline < date('now') AND sent = 0"
    )
    .run();
  return result.changes;
}

export function updateScore(
  id: number,
  score: number,
  reason: string,
  flag: string
): void {
  const db = getDb();
  db.prepare(
    "UPDATE jobs SET relevance_score = ?, relevance_reason = ?, language_flag = ? WHERE id = ?"
  ).run(score, reason, flag, id);
}

export function suppressLowScoring(threshold: number): number {
  const db = getDb();
  const result = db
    .prepare(
      "UPDATE jobs SET sent = 1 WHERE relevance_score IS NOT NULL AND relevance_score < ? AND sent = 0"
    )
    .run(threshold);
  return result.changes;
}

export function getScoredUnsentJobs(): Job[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM jobs WHERE sent = 0 AND relevance_score IS NOT NULL ORDER BY relevance_score DESC"
    )
    .all() as Job[];
}

export function markSent(ids: number[]): void {
  if (ids.length === 0) {
    return;
  }
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`UPDATE jobs SET sent = 1 WHERE id IN (${placeholders})`).run(
    ...ids
  );
}

export function getAllUrls(): string[] {
  const db = getDb();
  return (db.prepare("SELECT url FROM jobs").all() as { url: string }[]).map(
    (r) => r.url
  );
}
