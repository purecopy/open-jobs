import { storeArtifact } from "./artifacts.js";
import type { ScrapedPage } from "./crawl/firecrawl.js";
import { crawlAggregator, scrape } from "./crawl/firecrawl.js";
import { discoverJobs } from "./crawl/perplexity.js";
import { platforms } from "./crawl/platforms.js";
import { getAllUrls } from "./db.js";
import { dedup } from "./dedup.js";
import { generateDigest } from "./digest.js";
import { extractJobs } from "./extract.js";
import { createLogger } from "./logger.js";
import { scoreJobs } from "./score.js";

const log = createLogger("pipeline");
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

    const newPages = pages.filter((p) => !knownUrls.has(p.url));
    const skippedCount = pages.length - newPages.length;
    if (skippedCount > 0) {
      log.debug(`${skippedCount} page(s) skipped (already known)`);
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
  log.info(`Crawling ${platform.id} (${platform.type})`);

  const pages = await scrapePlatform(platform, knownUrls);
  if (pages.length === 0) {
    log.info(`No new pages from ${platform.id}`);
    return { pages: 0, inserted: 0, skipped: 0 };
  }

  log.info(`Got ${pages.length} page(s) from ${platform.id}`);

  // Store scraped markdown as debug artifacts
  for (const page of pages) {
    const filename = `${new URL(page.url).pathname.replace(/\//g, "_")}.md`;
    storeArtifact(`markdown/${platform.id}`, filename, page.markdown);
  }

  const jobs = await extractJobs(pages, platform.id);
  log.info(`Extracted ${jobs.length} job(s) from ${platform.id}`);

  // Debug: log pages and extracted jobs for all platforms
  for (const page of pages) {
    log.debug(
      `Page: ${page.url} | markdown preview: ${page.markdown.slice(0, 200).replace(/\n/g, " ")}`
    );
  }
  for (const job of jobs) {
    log.debug(
      `Job: "${job.title}" @ ${job.company} | url=${job.url} | deadline=${job.deadline}`
    );
  }
  if (jobs.length === 0 && pages[0]) {
    log.debug(
      `No jobs extracted from ${platform.id}. First page markdown (3000 chars):\n${pages[0].markdown.slice(0, 3000)}`
    );
  }

  const result = await dedup(jobs, platform.id);

  for (const job of jobs) {
    knownUrls.add(job.url);
  }

  log.info(
    `${platform.id}: ${result.inserted} new, ${result.skipped} duplicates`
  );

  return { pages: pages.length, ...result };
}

async function crawl(): Promise<void> {
  log.info("Starting platform crawl");
  let totalPages = 0;
  let totalInserted = 0;
  let totalSkipped = 0;

  const knownUrls = new Set(await getAllUrls());
  log.info(`Loaded ${knownUrls.size} known URL(s) from DB`);

  for (const platform of platforms) {
    try {
      const stats = await crawlPlatform(platform, knownUrls);
      totalPages += stats.pages;
      totalInserted += stats.inserted;
      totalSkipped += stats.skipped;
    } catch (err) {
      const msg = `${platform.id}: ${err instanceof Error ? err.message : err}`;
      log.error(`Error crawling ${platform.id}: ${msg}`);
      errors.push(msg);
    }
  }

  // Perplexity discovery
  try {
    log.info("Running Perplexity discovery");
    const discoveredUrls = await discoverJobs();
    log.info(`Perplexity found ${discoveredUrls.length} new URL(s)`);

    for (const url of discoveredUrls) {
      try {
        const page = await scrape(url);
        storeArtifact(
          "markdown/perplexity",
          `${new URL(url).pathname.replace(/\//g, "_")}.md`,
          page.markdown
        );
        const jobs = await extractJobs([page], "perplexity");
        const result = await dedup(jobs, "perplexity");
        totalInserted += result.inserted;
        totalSkipped += result.skipped;
        totalPages++;
      } catch (err) {
        log.error(
          `Failed to process discovered URL ${url}: ${err instanceof Error ? err.message : err}`
        );
      }
    }
  } catch (err) {
    const msg = `perplexity: ${err instanceof Error ? err.message : err}`;
    log.error(`Error in Perplexity discovery: ${msg}`);
    errors.push(msg);
  }

  log.info(
    `Crawl done. ${totalPages} pages scraped, ${totalInserted} new jobs, ${totalSkipped} duplicates`
  );
}

async function score(): Promise<void> {
  log.info("Scoring jobs");
  try {
    const result = await scoreJobs();
    log.info(
      `Scoring done. ${result.scored} scored, ${result.expired} expired, ${result.suppressed} suppressed`
    );
  } catch (err) {
    const msg = `scoring: ${err instanceof Error ? err.message : err}`;
    log.error(`Error scoring: ${msg}`);
    errors.push(msg);
  }
}

async function digest(): Promise<void> {
  log.info("Generating digest");
  try {
    const output = await generateDigest();
    if (output) {
      // Digest goes to stdout for OpenClaw to pick up
      process.stdout.write(`${output}\n`);
    } else {
      log.info("No new jobs to report");
    }
  } catch (err) {
    const msg = `digest: ${err instanceof Error ? err.message : err}`;
    log.error(`Error generating digest: ${msg}`);
    errors.push(msg);
  }
}

async function run(): Promise<void> {
  await crawl();
  await score();
  await digest();

  if (errors.length > 0) {
    log.warn(`job-claw errors: ${errors.join("; ")}`);
  }
}

// CLI dispatch
const command = process.argv[2];

switch (command) {
  case "crawl":
    crawl().catch((err) => log.error(String(err)));
    break;
  case "score":
    score().catch((err) => log.error(String(err)));
    break;
  case "digest":
    digest().catch((err) => log.error(String(err)));
    break;
  case "run":
    run().catch((err) => log.error(String(err)));
    break;
  default:
    process.stderr.write("Usage: job-claw <crawl|score|digest|run>\n");
    process.exit(1);
}
