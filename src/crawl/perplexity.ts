import { getConfig } from "../config.js";
import { getAllUrls } from "../db.js";

interface PerplexityMessage {
  role: string;
  content: string;
}

interface PerplexityResponse {
  choices: { message: { content: string } }[];
  citations?: string[];
}

export async function discoverJobs(): Promise<string[]> {
  const config = getConfig();
  const profile = config.profile;

  const rolesList = profile.roles.slice(0, 5).join(", ");
  const locations = profile.location.preferred.join(", ");

  const query = `Current job openings in ${locations} Austria: ${rolesList} at museums, galleries, Kunstvereine, cultural institutions. Include English-friendly workplaces. Return URLs to the actual job postings.`;

  const messages: PerplexityMessage[] = [
    {
      role: "system",
      content: "You are a job search assistant. Find current, active job listings matching the query. Return the specific URLs to job postings, not general career pages.",
    },
    { role: "user", content: query },
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
    }),
  });

  if (!response.ok) {
    throw new Error(`Perplexity API error: ${response.status} ${response.statusText}`);
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
  const knownUrls = new Set(getAllUrls());
  const newUrls = [...urls].filter((u) => {
    // Skip generic pages
    try {
      const path = new URL(u).pathname.toLowerCase();
      if (path === "/" || path === "") return false;
    } catch {
      return false;
    }
    return !knownUrls.has(u);
  });

  return newUrls;
}
