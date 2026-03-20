import { createHash } from "node:crypto";
import { insertJob } from "./db.js";
import type { RawJob } from "./extract.js";

export function computeFingerprint(company: string, title: string): string {
  const input = `${company.toLowerCase().trim()}|${title.toLowerCase().trim()}`;
  return createHash("sha256").update(input).digest("hex");
}

export interface DedupResult {
  inserted: number;
  skipped: number;
}

export function dedup(jobs: RawJob[], platform: string): DedupResult {
  let inserted = 0;
  let skipped = 0;

  for (const job of jobs) {
    const fingerprint = computeFingerprint(job.company, job.title);
    const wasInserted = insertJob({
      fingerprint,
      title: job.title,
      title_en: job.title_en,
      company: job.company,
      url: job.url,
      platform,
      location: job.location,
      employment_type: job.employment_type,
      language_required: job.language_required,
      description: job.description,
      salary: job.salary,
      deadline: job.deadline,
      posted_at: job.posted_at,
      crawled_at: new Date().toISOString(),
    });

    if (wasInserted) {
      inserted++;
    } else {
      skipped++;
    }
  }

  return { inserted, skipped };
}
