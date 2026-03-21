import type Anthropic from "@anthropic-ai/sdk";
import type { ScrapedPage } from "./crawl/firecrawl.js";
import { getAnthropicClient } from "./libs/anthropic.js";
import { chunk } from "./utils/chunk.js";

const MODEL = "claude-sonnet-4-6";
const BATCH_SIZE = 5;
const JSON_ARRAY_RE = /\[[\s\S]*\]/;

export interface RawJob {
  company: string;
  deadline: string;
  description: string;
  employment_type: string;
  language_required: string;
  location: string;
  posted_at: string;
  salary: string;
  title: string;
  title_en: string;
  url: string;
}

async function extractBatch(
  client: Anthropic,
  batch: ScrapedPage[]
): Promise<RawJob[]> {
  const pagesContent = batch
    .map(
      (p, i) => `--- Page ${i + 1}: ${p.url} ---\n${p.markdown.slice(0, 8000)}`
    )
    .join("\n\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `Extract all job listings from the following scraped web pages. For each job, return a JSON object with these fields:

- title: Original job title as written
- title_en: English translation of the title
- company: Organization/company name
- url: Direct link to the job listing
- location: Location as stated (city, region)
- employment_type: "full-time", "part-time", or "unknown"
- language_required: e.g. "Deutsch C1", "English ok", "unclear" — be specific about what the listing states
- description: 2-3 sentence summary of the role
- salary: If mentioned, otherwise ""
- deadline: Application deadline in ISO 8601 format if stated, otherwise "". If the page says the deadline has passed, the listing is closed, expired, or no longer accepting applications, set deadline to "expired".
- posted_at: Posting date in ISO 8601 format if visible, otherwise ""

If the listing language requirements are unclear, mark as "unclear".
If a page contains no job listings, skip it.
If a listing is clearly expired or closed, still extract it but set deadline to "expired".

Return ONLY a JSON array of job objects, no other text.

${pagesContent}`,
      },
    ],
  });

  const text =
    response.content[0]?.type === "text" ? response.content[0].text : "";

  const jsonMatch = text.match(JSON_ARRAY_RE);
  if (!jsonMatch) {
    return [];
  }
  const jobs = JSON.parse(jsonMatch[0]) as RawJob[];
  return jobs.map((job) => ({
    ...job,
    url: job.url || (batch.length === 1 ? batch[0].url : ""),
  }));
}

export async function extractJobs(
  pages: ScrapedPage[],
  platform: string
): Promise<RawJob[]> {
  if (pages.length === 0) {
    return [];
  }

  const client = getAnthropicClient();
  const allJobs: RawJob[] = [];
  const batches = chunk(pages, BATCH_SIZE);

  for (const [i, batch] of batches.entries()) {
    console.log(
      `  Extracting batch ${i + 1}/${batches.length} (${batch.length} pages) for ${platform}`
    );

    try {
      const jobs = await extractBatch(client, batch);
      allJobs.push(...jobs);
    } catch (err) {
      console.error(
        `  Failed to extract batch ${i + 1} for ${platform}: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  return allJobs;
}
