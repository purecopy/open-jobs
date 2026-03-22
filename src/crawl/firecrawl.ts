import {
  getFirecrawlClient,
  getResetDelay,
  isRateLimitError,
} from "../libs/firecrawl.js";
import { withRetry } from "../libs/retry.js";
import { createLogger } from "../logger.js";
import type { CrawlScopeOptions } from "./platforms.js";

const log = createLogger("firecrawl");

export interface ScrapedPage {
  markdown: string;
  url: string;
}

const SCRAPE_OPTIONS = {
  formats: ["markdown" as const],
  onlyMainContent: false,
};

export function scrape(url: string): Promise<ScrapedPage> {
  const client = getFirecrawlClient();

  return withRetry(
    async () => {
      const result = await client.scrape(url, SCRAPE_OPTIONS);
      if (!result.markdown) {
        throw new Error(`Firecrawl scrape returned no content for ${url}`);
      }
      return { url, markdown: result.markdown };
    },
    {
      maxRetries: 3,
      fallbackDelayMs: 15_000,
      shouldRetry: isRateLimitError,
      getRetryDelay: getResetDelay,
      onRetry: (_, attempt, delayMs) => {
        log.warn(
          `Rate limited on ${url}, retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt}/3)`
        );
      },
    }
  );
}

export async function discoverAggregatorJobs(
  platformUrl: string,
  scope?: CrawlScopeOptions
): Promise<ScrapedPage[]> {
  const client = getFirecrawlClient();

  const job = await withRetry(
    () =>
      client.crawl(platformUrl, {
        scrapeOptions: SCRAPE_OPTIONS,
        includePaths: scope?.includePaths,
        excludePaths: scope?.excludePaths,
        limit: scope?.limit ?? 50,
        sitemap: "skip",
        maxDiscoveryDepth: 1,
        crawlEntireDomain: true,
      }),
    {
      maxRetries: 3,
      fallbackDelayMs: 15_000,
      shouldRetry: isRateLimitError,
      getRetryDelay: getResetDelay,
      onRetry: (_, attempt, delayMs) => {
        log.warn(
          `Rate limited on ${platformUrl}, retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt}/3)`
        );
      },
    }
  );

  if (job.status === "failed") {
    throw new Error(`Crawl failed for ${platformUrl}`);
  }

  const pages: ScrapedPage[] = [];
  for (const doc of job.data) {
    if (doc.markdown && doc.metadata?.sourceURL) {
      pages.push({ markdown: doc.markdown, url: doc.metadata.sourceURL });
    }
  }

  log.debug(`Crawl returned ${pages.length} page(s) for ${platformUrl}`);

  return pages;
}
