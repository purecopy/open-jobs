import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { getConfig } from "./config.js";
import {
  expireJobs,
  getUnscoredJobs,
  suppressLowScoring,
  updateScore,
} from "./db.js";
import { getAnthropicClient } from "./libs/anthropic.js";
import { createLogger } from "./logger.js";
import { chunk } from "./utils/chunk.js";

const log = createLogger("score");

const MODEL = "claude-opus-4-6";
const BATCH_SIZE = 10;

const ScoredJobSchema = z.object({
  id: z.number(),
  language_flag: z.enum(["green", "yellow", "red"]),
  relevance_reason: z.string(),
  relevance_score: z.number(),
});

const ScoringResultSchema = z.object({
  jobs: z.array(ScoredJobSchema),
});

type ScoredJob = z.infer<typeof ScoredJobSchema>;

type UnscoredJob = Awaited<ReturnType<typeof getUnscoredJobs>>[number];

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

  const response = await client.messages.parse({
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

For each job, return an object with: id, relevance_score (1-10), relevance_reason (one sentence, English), language_flag ("green"/"yellow"/"red").

Jobs to score:
${jobsList}`,
      },
    ],
    output_config: {
      format: zodOutputFormat(ScoringResultSchema),
    },
  });

  return response.parsed_output?.jobs ?? [];
}

export interface ScoreResult {
  expired: number;
  scored: number;
  suppressed: number;
}

export async function scoreJobs(): Promise<ScoreResult> {
  const config = getConfig();

  const expired = await expireJobs();
  if (expired > 0) {
    log.info(`Expired ${expired} jobs past their deadline`);
  }

  const jobs = await getUnscoredJobs();
  if (jobs.length === 0) {
    return { expired, scored: 0, suppressed: 0 };
  }

  const client = getAnthropicClient();
  const profileJson = JSON.stringify(config.profile, null, 2);

  let totalScored = 0;
  const batches = chunk(jobs, BATCH_SIZE);

  for (const [i, batch] of batches.entries()) {
    log.info(`Scoring batch ${i + 1}/${batches.length} (${batch.length} jobs)`);

    try {
      const scored = await scoreBatch(client, profileJson, batch);
      for (const s of scored) {
        await updateScore(
          s.id,
          s.relevance_score,
          s.relevance_reason,
          s.language_flag
        );
      }
      totalScored += scored.length;
    } catch (err) {
      log.error(
        `Failed to parse batch ${i + 1}: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  const suppressed = await suppressLowScoring(config.relevanceThreshold);

  return { expired, scored: totalScored, suppressed };
}
