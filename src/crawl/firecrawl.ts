import {
  getFirecrawlClient,
  getResetDelay,
  isRateLimitError,
} from "../libs/firecrawl.js";
import { withRetry } from "../libs/retry.js";
import type { CrawlScopeOptions } from "./platforms.js";

export interface ScrapedPage {
  markdown: string;
  url: string;
}

export function scrape(url: string): Promise<ScrapedPage> {
  const client = getFirecrawlClient();

  return withRetry(
    async () => {
      const result = await client.scrape(url, { formats: ["markdown"] });
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
        console.warn(
          `  Rate limited on ${url}, retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt}/3)...`
        );
      },
    }
  );
}

export async function crawlAggregator(
  platformUrl: string,
  scope?: CrawlScopeOptions
): Promise<ScrapedPage[]> {
  const client = getFirecrawlClient();

  const job = await withRetry(
    () =>
      client.crawl(platformUrl, {
        maxDiscoveryDepth: 1,
        sitemap: "skip",
        ignoreQueryParameters: true,
        deduplicateSimilarURLs: true,
        includePaths: scope?.includePaths ?? undefined,
        excludePaths: scope?.excludePaths ?? undefined,
        limit: scope?.limit ?? 50,
        scrapeOptions: { formats: ["markdown"] },
      }),
    {
      maxRetries: 3,
      fallbackDelayMs: 15_000,
      shouldRetry: isRateLimitError,
      getRetryDelay: getResetDelay,
      onRetry: (_, attempt, delayMs) => {
        console.warn(
          `  Rate limited on crawl ${platformUrl}, retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt}/3)...`
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

  if (pages.length === 0) {
    // Fallback: scrape the overview page directly
    const overview = await scrape(platformUrl);
    return [overview];
  }

  return pages;
}
