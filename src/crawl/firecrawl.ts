import FirecrawlApp from "@mendable/firecrawl-js";
import { getConfig } from "../config.js";

let _client: FirecrawlApp | null = null;

function getClient(): FirecrawlApp {
    if (!_client) {
        _client = new FirecrawlApp({ apiKey: getConfig().firecrawlApiKey });
    }
    return _client;
}

export interface ScrapedPage {
    url: string;
    markdown: string;
}

export async function scrape(url: string): Promise<ScrapedPage> {
    const client = getClient();
    const result = await client.scrape(url, { formats: ["markdown"] });
    if (!result.markdown) {
        throw new Error(`Firecrawl scrape returned no content for ${url}`);
    }
    return { url, markdown: result.markdown };
}

export function extractJobUrls(markdown: string, baseUrl: string): string[] {
    const urlRegex = /https?:\/\/[^\s"')>\]]+/g;
    const matches = markdown.match(urlRegex) || [];

    const baseDomain = new URL(baseUrl).hostname.replace("www.", "");

    return [...new Set(matches)].filter((u) => {
        try {
            const parsed = new URL(u);
            const domain = parsed.hostname.replace("www.", "");
            // Keep URLs from the same domain that look like individual job pages
            // Filter out generic pages (homepage, about, contact, impressum, etc.)
            if (domain !== baseDomain) return false;
            const path = parsed.pathname.toLowerCase();
            const genericPaths = [
                "/",
                "/about",
                "/contact",
                "/impressum",
                "/datenschutz",
                "/agb",
                "/team",
            ];
            if (genericPaths.includes(path)) return false;
            // Must be deeper than the base listing page
            const basePath = new URL(baseUrl).pathname;
            if (path === basePath || path === basePath.replace(/\/$/, ""))
                return false;
            return true;
        } catch {
            return false;
        }
    });
}

export async function crawlAggregator(
    platformUrl: string,
): Promise<ScrapedPage[]> {
    // Step 1: Scrape the overview page
    const overview = await scrape(platformUrl);

    // Step 2: Extract individual job URLs from the overview markdown
    const jobUrls = extractJobUrls(overview.markdown, platformUrl);

    if (jobUrls.length === 0) {
        // If we can't extract individual URLs, return the overview itself
        return [overview];
    }

    // Step 3: Scrape each detail page
    const pages: ScrapedPage[] = [];
    for (const url of jobUrls) {
        try {
            const page = await scrape(url);
            pages.push(page);
        } catch (err) {
            console.error(
                `  Failed to scrape ${url}: ${err instanceof Error ? err.message : err}`,
            );
        }
    }

    return pages;
}
