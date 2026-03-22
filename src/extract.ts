import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { storeArtifact } from "./artifacts.js";
import type { ScrapedPage } from "./crawl/firecrawl.js";
import { getAnthropicClient } from "./libs/anthropic.js";
import { createLogger } from "./logger.js";
import { chunk } from "./utils/chunk.js";

const log = createLogger("extract");

const MODEL = "claude-sonnet-4-6";
const BATCH_SIZE = 5;

const RawJobSchema = z.object({
  company: z.string(),
  deadline: z.string().nullable(),
  description: z.string(),
  employment_type: z.enum(["full-time", "part-time", "unknown"]),
  language_required: z.string(),
  location: z.string(),
  posted_at: z.string().nullable(),
  salary: z.string().nullable(),
  title: z.string(),
  title_en: z.string(),
  url: z.string(),
});

const ExtractionResultSchema = z.object({
  jobs: z.array(RawJobSchema),
});

export type RawJob = z.infer<typeof RawJobSchema>;

async function extractBatch(
  client: Anthropic,
  batch: ScrapedPage[],
  platform: string,
  batchLabel: string
): Promise<RawJob[]> {
  const pagesContent = batch
    .map((p, i) => `--- Page ${i + 1}: ${p.url} ---\n${p.markdown}`)
    .join("\n\n");

  storeArtifact(
    "extraction-input",
    `${platform}-${batchLabel}.txt`,
    pagesContent
  );

  const today = new Date().toISOString().split("T")[0];

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16_384,
    system:
      "You are a structured data extractor. Extract job listings from scraped web pages into the requested JSON format. Be precise and consistent. Do not invent information that is not present on the page.",
    messages: [
      {
        role: "user",
        content: `Extract all job listings from the following scraped web pages. Today's date is ${today}.

For each job, return a JSON object with these fields:

- title: Original job title exactly as written on the page
- title_en: English translation of the title. If the title is already in English, repeat it as-is
- company: Organization/company name
- url: Direct link to the job listing. If no direct link exists, use the page URL from the header (e.g. "Page 1: <url>")
- location: Location as stated (city, region)
- employment_type: "full-time", "part-time", or "unknown"
- language_required: e.g. "Deutsch C1", "English ok", "unclear" — be specific about what the listing states
- description: 2-3 sentence summary covering the role's main responsibilities and requirements
- salary: Salary or pay range if mentioned, otherwise null
- deadline: Application deadline in ISO 8601 format if stated, otherwise null. If the deadline is in the past relative to today (${today}), or the listing says it is closed/expired/no longer accepting applications, set to "expired"
- posted_at: Posting date in ISO 8601 format if visible, otherwise null

If the listing language requirements are unclear, mark language_required as "unclear".
If a page contains no job listings, skip it.
If a listing is clearly expired or closed, still extract it but set deadline to "expired".

${pagesContent}`,
      },
    ],
    output_config: {
      format: zodOutputFormat(ExtractionResultSchema),
    },
  });

  const result = response.parsed_output;

  storeArtifact(
    "extraction-output",
    `${platform}-${batchLabel}.txt`,
    JSON.stringify(result, null, 2)
  );

  if (!result) {
    return [];
  }

  return result.jobs.map((job) => ({
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
    const batchLabel = `batch-${i + 1}`;
    log.info(
      `Extracting ${batchLabel}/${batches.length} (${batch.length} pages) for ${platform}`
    );

    try {
      const jobs = await extractBatch(client, batch, platform, batchLabel);
      allJobs.push(...jobs);
    } catch (err) {
      log.error(
        `Failed to extract ${batchLabel} for ${platform}: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  return allJobs;
}
