import { getScoredUnsentJobs, markSent } from "./db.js";
import type { Job } from "./db.js";

const FLAG_EMOJI: Record<string, string> = {
  green: "🟢 English ok",
  yellow: "🟡 Some German helpful",
  red: "🔴 German required",
};

function formatJob(job: Job): string {
  const flag = FLAG_EMOJI[job.language_flag] || "⚪ Unknown";
  const title = job.title_en && job.title_en !== job.title ? `${job.title}\n${job.title_en}` : job.title;
  const type = job.employment_type !== "unknown" ? ` · ${job.employment_type.charAt(0).toUpperCase() + job.employment_type.slice(1)}` : "";

  return [
    `⭐ ${job.relevance_score}/10 · ${flag}`,
    title,
    job.company,
    `📍 ${job.location || "Location not specified"}${type}`,
    `"${job.relevance_reason}"`,
    `🔗 ${job.url}`,
  ].join("\n");
}

export function generateDigest(): string | null {
  const jobs = getScoredUnsentJobs();

  if (jobs.length === 0) {
    return null;
  }

  const date = new Date().toISOString().split("T")[0];
  const header = `🔍 OpenClaw Digest — ${jobs.length} new job${jobs.length === 1 ? "" : "s"}\n📅 ${date}`;
  const separator = "\n\n━━━━━━━━━━━━━━━━━━━━\n\n";

  const body = jobs.map(formatJob).join(separator);
  const digest = `${header}${separator}${body}`;

  // Mark all included jobs as sent
  markSent(jobs.map((j) => j.id!));

  return digest;
}
