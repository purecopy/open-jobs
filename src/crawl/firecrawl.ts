import {
  getFirecrawlClient,
  getResetDelay,
  isRateLimitError,
} from "../libs/firecrawl.js";
import { withRetry } from "../libs/retry.js";
import { createLogger } from "../logger.js";
import { chunk } from "../utils/chunk.js";
import type { CrawlScopeOptions } from "./platforms.js";

const log = createLogger("firecrawl");

export interface ScrapedPage {
  markdown: string;
  url: string;
}

const MARKDOWN_LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;
const SCRAPE_CONCURRENCY = 3;

function matchesIncludePaths(
  pathname: string,
  includePaths: string[]
): boolean {
  return includePaths.some((pattern) => new RegExp(pattern).test(pathname));
}

function extractMatchingUrls(
  markdown: string,
  baseUrl: string,
  includePaths: string[]
): string[] {
  const origin = new URL(baseUrl).origin;
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const [, , href] of markdown.matchAll(MARKDOWN_LINK_RE)) {
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.origin !== origin) {
        continue;
      }
      if (!matchesIncludePaths(resolved.pathname, includePaths)) {
        continue;
      }
      const canonical = resolved.origin + resolved.pathname;
      if (seen.has(canonical)) {
        continue;
      }
      seen.add(canonical);
      urls.push(canonical);
    } catch {
      // skip malformed URLs
    }
  }

  return urls;
}

async function scrapeUrls(urls: string[]): Promise<ScrapedPage[]> {
  const pages: ScrapedPage[] = [];

  for (const batch of chunk(urls, SCRAPE_CONCURRENCY)) {
    const results = await Promise.allSettled(batch.map((url) => scrape(url)));
    for (const result of results) {
      if (result.status === "fulfilled") {
        pages.push(result.value);
      } else {
        log.warn(`Failed to scrape: ${result.reason}`);
      }
    }
  }

  return pages;
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
        log.warn(
          `Rate limited on ${url}, retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt}/3)`
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
  const limit = scope?.limit ?? 50;

  // Don't pass includePaths to Firecrawl — it prevents visiting the starting
  // URL when the pattern doesn't match it. We filter results afterward instead.
  const job = await withRetry(
    () =>
      client.crawl(platformUrl, {
        maxDiscoveryDepth: 1,
        sitemap: "skip",
        crawlEntireDomain: true,
        ignoreQueryParameters: true,
        deduplicateSimilarURLs: true,
        excludePaths: scope?.excludePaths ?? undefined,
        limit,
        scrapeOptions: { formats: ["markdown"] },
      }),
    {
      maxRetries: 3,
      fallbackDelayMs: 15_000,
      shouldRetry: isRateLimitError,
      getRetryDelay: getResetDelay,
      onRetry: (_, attempt, delayMs) => {
        log.warn(
          `Rate limited on crawl ${platformUrl}, retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt}/3)`
        );
      },
    }
  );

  if (job.status === "failed") {
    throw new Error(`Crawl failed for ${platformUrl}`);
  }

  log.debug(`Crawl job status: ${job.status}, total docs: ${job.data.length}`);

  // Post-filter by includePaths (if defined) since we no longer pass them to Firecrawl
  const pages: ScrapedPage[] = [];
  for (const doc of job.data) {
    if (!(doc.markdown && doc.metadata?.sourceURL)) {
      continue;
    }
    const url = doc.metadata.sourceURL;
    if (scope?.includePaths) {
      const pathname = new URL(url).pathname;
      if (!matchesIncludePaths(pathname, scope.includePaths)) {
        continue;
      }
    }
    pages.push({ markdown: doc.markdown, url });
  }

  log.debug(`Usable pages after filtering: ${pages.length}`);

  if (pages.length > 0) {
    return pages;
  }

  // Fallback: scrape the overview page directly, then discover job URLs
  log.debug(
    `No usable pages from crawl, falling back to link discovery on ${platformUrl}`
  );
  const overview = await scrape(platformUrl);

  if (scope?.includePaths && scope.includePaths.length > 0) {
    const discoveredUrls = extractMatchingUrls(
      overview.markdown,
      platformUrl,
      scope.includePaths
    ).slice(0, limit);

    if (discoveredUrls.length > 0) {
      log.debug(
        `Discovered ${discoveredUrls.length} job URL(s) from overview, scraping individually`
      );
      return scrapeUrls(discoveredUrls);
    }
  }

  // Final fallback: return the overview page as-is
  return [overview];
}
