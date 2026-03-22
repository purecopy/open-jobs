import { getConfig } from "../config.js";
import { getAllUrls } from "../db.js";

interface PerplexityMessage {
  content: string;
  role: string;
}

interface PerplexityResponse {
  choices: { message: { content: string } }[];
  citations?: string[];
}

export async function discoverJobs(): Promise<string[]> {
  const config = getConfig();
  const profile = config.profile;

  const messages: PerplexityMessage[] = [
    {
      role: "system",
      content: `You are an expert job search assistant specializing in the Austrian arts and culture sector. Your task is to find real, currently open job postings matching the candidate profile provided as JSON.

Rules:
- Only return URLs that point to specific, individual job listings — not career landing pages or organizational homepages.
- Each URL must be for a position that is currently open and accepting applications.
- Include postings in both German and English.
- Respect the candidate's language abilities and dealbreakers when selecting results.
- For each URL, briefly note the role title and employer so the results can be verified.
- If a job board aggregates listings, return the direct link to the specific posting, not the search results page.
- Search on Austrian job boards (karriere.at, ams.at, StepStone.at), cultural job boards (kunstjobs.at, basis-wien.at, cultural-jobs.net, IG Kultur), and directly on institutional career pages.`,
    },
    {
      role: "user",
      content: `Find currently open job postings matching this candidate profile:

${JSON.stringify(profile, null, 2)}

Target employers: museums, galleries, Kunstvereine, Kulturhäuser, art foundations, biennials, cultural festivals, publishers, and arts organizations in Austria.

Return only direct URLs to individual job postings that are currently accepting applications.`,
    },
  ];

  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.perplexityApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar",
      messages,
      search_recency_filter: "week",
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Perplexity API error: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as PerplexityResponse;

  // Collect URLs from both citations and response content
  const urls = new Set<string>();

  // Citations are the primary source of URLs from Perplexity
  if (data.citations) {
    for (const url of data.citations) {
      urls.add(url);
    }
  }

  // Also extract URLs from the response text
  const content = data.choices[0]?.message?.content || "";
  const urlRegex = /https?:\/\/[^\s"')>\]]+/g;
  const matches = content.match(urlRegex) || [];
  for (const url of matches) {
    urls.add(url);
  }

  // Filter out URLs we already have in the DB
  const knownUrls = new Set(await getAllUrls());
  const newUrls = [...urls].filter((u) => {
    // Skip generic pages
    try {
      const path = new URL(u).pathname.toLowerCase();
      if (path === "/" || path === "") {
        return false;
      }
    } catch {
      return false;
    }
    return !knownUrls.has(u);
  });

  return newUrls;
}
