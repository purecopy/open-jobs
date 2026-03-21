import Anthropic from "@anthropic-ai/sdk";
import { getConfig } from "./config.js";
import {
  expireJobs,
  getUnscoredJobs,
  suppressLowScoring,
  updateScore,
} from "./db.js";
import { chunk } from "./utils/chunk.js";

const MODEL = "claude-opus-4-6";
const BATCH_SIZE = 10;
const JSON_ARRAY_RE = /\[[\s\S]*\]/;

interface ScoredJob {
  id: number;
  language_flag: "green" | "yellow" | "red";
  relevance_reason: string;
  relevance_score: number;
}

type UnscoredJob = ReturnType<typeof getUnscoredJobs>[number];

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: getConfig().anthropicApiKey,
      maxRetries: 5,
    });
  }
  return _client;
}

async function scoreBatch(
  client: Anthropic,
  profileJson: string,
  batch: UnscoredJob[]
): Promise<ScoredJob[]> {
  const jobsList = batch
    .map(
      (j) =>
        `[ID: ${j.id}] "${j.title}" at ${j.company} | Location: ${j.location} | Type: ${j.employment_type} | Language: ${j.language_required} | Description: ${j.description}`
    )
    .join("\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are scoring job listings for relevance to a specific candidate. Here is their profile:

${profileJson}

Scoring guidance:
- 9-10: Strong match — curatorial, mediation, sound/media art, or comms role; English-friendly; Wien/NÖ
- 7-8: Good match — related cultural role; language situation manageable or unclear
- 5-6: Partial match — tangentially relevant, or good role but German likely needed
- 3-4: Weak match — role is adjacent but significant gaps (wrong field, hard German requirement)
- 1-2: Poor match — unrelated or dealbreaker present

Language flag (independent of score):
- "green": English ok / no German needed / international workplace
- "yellow": Some German helpful, A2-B1 might suffice
- "red": Fluent German (C1+) explicitly required

For each job, return a JSON object with: id, relevance_score (1-10), relevance_reason (one sentence, English), language_flag ("green"/"yellow"/"red").

Return ONLY a JSON array, no other text.

Jobs to score:
${jobsList}`,
      },
    ],
  });

  const text =
    response.content[0]?.type === "text" ? response.content[0].text : "";

  const jsonMatch = text.match(JSON_ARRAY_RE);
  if (!jsonMatch) {
    throw new Error("No JSON array in response");
  }
  return JSON.parse(jsonMatch[0]) as ScoredJob[];
}

export interface ScoreResult {
  expired: number;
  scored: number;
  suppressed: number;
}

export async function scoreJobs(): Promise<ScoreResult> {
  const config = getConfig();

  const expired = expireJobs();
  if (expired > 0) {
    console.log(`  Expired ${expired} jobs past their deadline`);
  }

  const jobs = getUnscoredJobs();
  if (jobs.length === 0) {
    return { expired, scored: 0, suppressed: 0 };
  }

  const client = getClient();
  const profileJson = JSON.stringify(config.profile, null, 2);

  let totalScored = 0;
  const batches = chunk(jobs, BATCH_SIZE);

  for (const [i, batch] of batches.entries()) {
    console.log(
      `  Scoring batch ${i + 1}/${batches.length} (${batch.length} jobs)`
    );

    try {
      const scored = await scoreBatch(client, profileJson, batch);
      for (const s of scored) {
        updateScore(
          s.id,
          s.relevance_score,
          s.relevance_reason,
          s.language_flag
        );
      }
      totalScored += scored.length;
    } catch (err) {
      console.error(
        `  Failed to parse batch ${i + 1}: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  const suppressed = suppressLowScoring(config.relevanceThreshold);

  return { expired, scored: totalScored, suppressed };
}
