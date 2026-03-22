import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { getConfig, type Profile } from "./config.js";
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

const MODEL = "claude-sonnet-4-6";
const BATCH_SIZE = 5;

const ScoredJobSchema = z.object({
  id: z.number().int(),
  language_flag: z.enum(["green", "yellow", "red"]),
  relevance_reason: z.string(),
  relevance_score: z.number().int().min(1).max(5),
});

const ScoringResultSchema = z.object({
  jobs: z.array(ScoredJobSchema),
});

type ScoredJob = z.infer<typeof ScoredJobSchema>;

type UnscoredJob = Awaited<ReturnType<typeof getUnscoredJobs>>[number];

function buildScoringRubric(profile: Profile): string {
  const roles = profile.roles.slice(0, 4).join(", ");
  const locations = profile.location.preferred.join("/");

  return `Scoring scale (1-5):
- 5: Strong match — role closely aligns with candidate's target roles (${roles}); location is ${locations} or remote; no dealbreakers
- 4: Good match — related role in candidate's field; minor gaps in fit (e.g. language situation unclear, slightly outside core expertise)
- 3: Partial match — tangentially relevant to candidate's strengths, or good role but likely blocked by a soft constraint
- 2: Weak match — role is adjacent but significant gaps (wrong field, missing key skills, or hard language barrier)
- 1: Poor match — unrelated to candidate's profile or a dealbreaker is present`;
}

async function scoreBatch(
  client: Anthropic,
  profileJson: string,
  rubric: string,
  batch: UnscoredJob[]
): Promise<ScoredJob[]> {
  const jobsList = JSON.stringify(
    batch.map((job) => ({
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      employment_type: job.employment_type,
      language_required: job.language_required,
      description: job.description,
    })),
    null,
    2
  );

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 4096,
    system:
      "You score job listings for relevance to a specific candidate. Be calibrated: most jobs should score 2-3. Reserve 5 for excellent matches and 1 for clear mismatches.",
    messages: [
      {
        role: "user",
        content: `Score these job listings for the following candidate.

## Candidate Profile

${profileJson}

## ${rubric}

Language flag (classify independently from score):
- "green": English ok / no German needed / international workplace
- "yellow": Some German helpful, A2-B1 might suffice
- "red": Fluent German (C1+) explicitly required

## Examples

[ID: 0] "Kuratorische Assistenz (m/w/d)" at Kunsthalle Wien | Location: Wien | Language: English ok, Deutsch B1 helpful
→ relevance_score: 5, language_flag: "green", relevance_reason: "Curatorial assistant at a major Vienna institution with English-friendly policy — direct match for core target role."

[ID: 0] "Buchhaltung / Office Management" at Tanzquartier Wien | Location: Wien | Language: Deutsch C1 erforderlich
→ relevance_score: 1, language_flag: "red", relevance_reason: "Accounting/office role requires skills outside candidate's profile and fluent German."

[ID: 0] "Projektkoordination Kulturprogramm" at Stadt Linz | Location: Linz | Language: Deutsch C1
→ relevance_score: 2, language_flag: "red", relevance_reason: "Relevant cultural coordination role but located outside preferred area and requires fluent German."

## Jobs to score

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
  const rubric = buildScoringRubric(config.profile);

  let totalScored = 0;
  const batches = chunk(jobs, BATCH_SIZE);

  for (const [i, batch] of batches.entries()) {
    log.info(`Scoring batch ${i + 1}/${batches.length} (${batch.length} jobs)`);

    try {
      const scored = await scoreBatch(client, profileJson, rubric, batch);

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
