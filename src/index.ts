import type { ScrapedPage } from "./crawl/firecrawl.js";
import { crawlAggregator, scrape } from "./crawl/firecrawl.js";
import { discoverJobs } from "./crawl/perplexity.js";
import { platforms } from "./crawl/platforms.js";
import { dedup } from "./dedup.js";
import { generateDigest } from "./digest.js";
import { extractJobs } from "./extract.js";
import { scoreJobs } from "./score.js";

const errors: string[] = [];

async function crawl(): Promise<void> {
  console.log("[crawl] Starting platform crawl...");
  let totalPages = 0;
  let totalInserted = 0;
  let totalSkipped = 0;

  for (const platform of platforms) {
    try {
      console.log(`  Crawling ${platform.id} (${platform.type})...`);
      let pages: ScrapedPage[];

      if (platform.type === "aggregator") {
        pages = await crawlAggregator(platform.url);
      } else {
        const page = await scrape(platform.url);
        pages = [page];
      }

      console.log(`  Got ${pages.length} page(s) from ${platform.id}`);
      totalPages += pages.length;

      // Extract jobs from scraped pages
      const jobs = await extractJobs(pages, platform.id);
      console.log(`  Extracted ${jobs.length} job(s) from ${platform.id}`);

      // Dedup and store
      const result = await dedup(jobs, platform.id);
      totalInserted += result.inserted;
      totalSkipped += result.skipped;
      console.log(
        `  ${platform.id}: ${result.inserted} new, ${result.skipped} duplicates`
      );
    } catch (err) {
      const msg = `${platform.id}: ${err instanceof Error ? err.message : err}`;
      console.error(`  Error crawling ${platform.id}: ${msg}`);
      errors.push(msg);
    }
  }

  // Perplexity discovery
  try {
    console.log("  Running Perplexity discovery...");
    const discoveredUrls = await discoverJobs();
    console.log(`  Perplexity found ${discoveredUrls.length} new URL(s)`);

    for (const url of discoveredUrls) {
      try {
        const page = await scrape(url);
        const jobs = await extractJobs([page], "perplexity");
        const result = await dedup(jobs, "perplexity");
        totalInserted += result.inserted;
        totalSkipped += result.skipped;
        totalPages++;
      } catch (err) {
        console.error(
          `  Failed to process discovered URL ${url}: ${err instanceof Error ? err.message : err}`
        );
      }
    }
  } catch (err) {
    const msg = `perplexity: ${err instanceof Error ? err.message : err}`;
    console.error(`  Error in Perplexity discovery: ${msg}`);
    errors.push(msg);
  }

  console.log(
    `[crawl] Done. ${totalPages} pages scraped, ${totalInserted} new jobs, ${totalSkipped} duplicates`
  );
}

async function score(): Promise<void> {
  console.log("[score] Scoring jobs...");
  try {
    const result = await scoreJobs();
    console.log(
      `[score] Done. ${result.scored} scored, ${result.expired} expired, ${result.suppressed} suppressed`
    );
  } catch (err) {
    const msg = `scoring: ${err instanceof Error ? err.message : err}`;
    console.error(`  Error scoring: ${msg}`);
    errors.push(msg);
  }
}

async function digest(): Promise<void> {
  console.log("[digest] Generating digest...");
  try {
    const output = await generateDigest();
    if (output) {
      // Print digest to stdout for OpenClaw to pick up
      console.log(output);
    } else {
      console.log("[digest] No new jobs to report.");
    }
  } catch (err) {
    const msg = `digest: ${err instanceof Error ? err.message : err}`;
    console.error(`  Error generating digest: ${msg}`);
    errors.push(msg);
  }
}

async function run(): Promise<void> {
  await crawl();
  await score();
  await digest();

  if (errors.length > 0) {
    console.log(`\n⚠️ job-claw errors: ${errors.join("; ")}`);
  }
}

// CLI dispatch
const command = process.argv[2];

switch (command) {
  case "crawl":
    crawl().catch(console.error);
    break;
  case "score":
    score().catch(console.error);
    break;
  case "digest":
    digest().catch(console.error);
    break;
  case "run":
    run().catch(console.error);
    break;
  default:
    console.log("Usage: job-claw <crawl|score|digest|run>");
    process.exit(1);
}
