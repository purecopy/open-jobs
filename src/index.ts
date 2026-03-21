import type { ScrapedPage } from "./crawl/firecrawl.js";
import { crawlAggregator, scrape } from "./crawl/firecrawl.js";
import { discoverJobs } from "./crawl/perplexity.js";
import { platforms } from "./crawl/platforms.js";
import { getAllUrls } from "./db.js";
import { dedup } from "./dedup.js";
import { generateDigest } from "./digest.js";
import { extractJobs } from "./extract.js";
import { scoreJobs } from "./score.js";

const errors: string[] = [];

interface CrawlStats {
  inserted: number;
  pages: number;
  skipped: number;
}

async function scrapePlatform(
  platform: (typeof platforms)[number],
  knownUrls: Set<string>
): Promise<ScrapedPage[]> {
  if (platform.type === "aggregator") {
    const pages = await crawlAggregator(platform.url, platform.crawlScope);

    // Filter out aggregator pages we've already extracted
    const newPages = pages.filter((p) => !knownUrls.has(p.url));
    const skippedCount = pages.length - newPages.length;
    if (skippedCount > 0) {
      console.log(`  ${skippedCount} page(s) skipped (already known)`);
    }

    return newPages;
  }

  const page = await scrape(platform.url);
  return [page];
}

async function crawlPlatform(
  platform: (typeof platforms)[number],
  knownUrls: Set<string>
): Promise<CrawlStats> {
  console.log(`  Crawling ${platform.id} (${platform.type})...`);

  const pages = await scrapePlatform(platform, knownUrls);
  if (pages.length === 0) {
    console.log(`  No new pages from ${platform.id}`);
    return { pages: 0, inserted: 0, skipped: 0 };
  }

  console.log(`  Got ${pages.length} page(s) from ${platform.id}`);

  const jobs = await extractJobs(pages, platform.id);
  console.log(`  Extracted ${jobs.length} job(s) from ${platform.id}`);

  const result = await dedup(jobs, platform.id);

  for (const job of jobs) {
    knownUrls.add(job.url);
  }

  console.log(
    `  ${platform.id}: ${result.inserted} new, ${result.skipped} duplicates`
  );

  return { pages: pages.length, ...result };
}

async function crawl(): Promise<void> {
  console.log("[crawl] Starting platform crawl...");
  let totalPages = 0;
  let totalInserted = 0;
  let totalSkipped = 0;

  const knownUrls = new Set(await getAllUrls());
  console.log(`  Loaded ${knownUrls.size} known URL(s) from DB`);

  for (const platform of platforms) {
    try {
      const stats = await crawlPlatform(platform, knownUrls);
      totalPages += stats.pages;
      totalInserted += stats.inserted;
      totalSkipped += stats.skipped;
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
