import Anthropic from "@anthropic-ai/sdk";
import { getConfig } from "./config.js";
import type { ScrapedPage } from "./crawl/firecrawl.js";

const MODEL = "claude-sonnet-4-6-20250514";

export interface RawJob {
  title: string;
  title_en: string;
  company: string;
  url: string;
  location: string;
  employment_type: string;
  language_required: string;
  description: string;
  salary: string;
  deadline: string;
  posted_at: string;
}

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: getConfig().anthropicApiKey });
  }
  return _client;
}

export async function extractJobs(pages: ScrapedPage[], platform: string): Promise<RawJob[]> {
  if (pages.length === 0) return [];

  const client = getClient();

  const pagesContent = pages
    .map((p, i) => `--- Page ${i + 1}: ${p.url} ---\n${p.markdown.slice(0, 8000)}`)
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
- deadline: Application deadline in ISO 8601 format if stated, otherwise ""
- posted_at: Posting date in ISO 8601 format if visible, otherwise ""

If the listing language requirements are unclear, mark as "unclear".
If a page contains no job listings, skip it.

Return ONLY a JSON array of job objects, no other text.

${pagesContent}`,
      },
    ],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";

  try {
    // Extract JSON array from response (may be wrapped in markdown code blocks)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const jobs = JSON.parse(jsonMatch[0]) as RawJob[];
    // Ensure each job has a url fallback
    return jobs.map((job, i) => ({
      ...job,
      url: job.url || pages[i]?.url || "",
    }));
  } catch (err) {
    console.error(`  Failed to parse extraction response for ${platform}: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}
