# OpenClaw — Initial Implementation Plan

## Context
Greenfield TypeScript/Node project. A daily cron job that crawls Austrian cultural sector job boards, extracts and normalizes listings via Claude, deduplicates against SQLite, scores for relevance, and sends a ranked Telegram digest. Stack confirmed: TypeScript + Node (not Go — SDKs for Anthropic/Firecrawl/Perplexity are first-class in TS).

## OpenClaw Integration Architecture

OpenClaw is a self-hosted messaging gateway + agent runtime. Key facts:
- It already has Telegram connected — no separate bot token needed in job-claw
- It has a **built-in cron scheduler** (persisted in `~/.openclaw/cron/`)
- It uses file-based storage — **no database**, so SQLite lives only in job-claw
- It can run shell commands via its `exec` tool from within agent turns

### Recommended integration: OpenClaw cron → exec → stdout digest

```
OpenClaw cron (8 AM daily)
  └─ exec: node /path/to/openclaw-job-claw/dist/index.js run
       └─ crawl → extract → dedup (SQLite) → score
       └─ prints formatted digest to stdout
  └─ OpenClaw agent reads stdout, sends via message tool → Telegram DM
```

**Why this approach:**
- No `TELEGRAM_BOT_TOKEN` in job-claw — OpenClaw owns the Telegram channel
- SQLite stays in job-claw for dedup + history (OpenClaw has no structured storage)
- Job can also be triggered on demand via chat: "run job search now"
- Ubuntu system cron is NOT needed — OpenClaw's scheduler persists across restarts via `~/.openclaw/cron/`

**What changes vs. original plan:**
- Remove `digest.ts` Telegram sending code — replaced by stdout output
- Remove `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` from env vars
- Add a cron job spec in `~/.openclaw/cron/` pointing at our script
- The script's `digest` command prints the formatted message to stdout instead of sending it

---

## File Structure to Create

```
openclaw/
├── src/
│   ├── index.ts           # CLI entrypoint: crawl / score / digest / run
│   ├── config.ts          # Load profile.json + env vars
│   ├── db.ts              # SQLite setup, schema migration, typed queries
│   ├── crawl/
│   │   ├── firecrawl.ts   # Firecrawl scrape wrapper → returns raw markdown
│   │   ├── perplexity.ts  # Perplexity search → returns URL list
│   │   └── platforms.ts   # Platform URL registry (kulturkonzepte, kupf, igkultur)
│   ├── extract.ts         # Claude: raw markdown → Job[] (Sonnet, structured output)
│   ├── dedup.ts           # SHA-256 fingerprint + INSERT OR IGNORE
│   ├── score.ts           # Claude: batch score unsent jobs (Sonnet)
│   └── digest.ts          # Format digest → print to stdout (OpenClaw sends it via message tool)
├── profile.json           # User profile / scoring criteria
├── .env.example
├── package.json
└── tsconfig.json

# Not in the repo — registered in OpenClaw:
# ~/.openclaw/cron/job-claw.json  (cron spec, runs our script + routes stdout → Telegram DM)

```

---

## Implementation Steps

### 1. Project scaffold
- `npm init -y`, add deps: `typescript`, `tsx`, `@anthropic-ai/sdk`, `@mendable/firecrawl-js`, `better-sqlite3`, `@types/better-sqlite3`, `dotenv`
- `tsconfig.json`: `target: ES2022`, `module: Node16`, `strict: true`
- `package.json` scripts: `build`, `dev` (tsx watch), `start` (node dist)

### 2. `config.ts`
- Load `.env` via dotenv
- Read and parse `profile.json`
- Export typed `Config` object with all env vars + profile

### 3. `db.ts`
- Open SQLite at `OPENCLAW_DB_PATH`
- Run migration: `CREATE TABLE IF NOT EXISTS jobs (...)` using the schema from the spec
- Fingerprint unique constraint: `UNIQUE(fingerprint)`
- Export: `insertJob(job)`, `getUnsentJobs()`, `updateScores(jobs)`, `markSent(ids[])`

### 4. `crawl/platforms.ts`
- Array of `{ id, url, type }` with two categories:

**Aggregators** (listing pages with multiple jobs):
- `kulturkonzepte.at/service/jobboerse/`
- `kupf.at/kulturjobs`
- `igkultur.at/service/stellenanzeigen-jobs-kultur`

**Institution career pages** (0-2 jobs each, scraped individually):
- `mumok.at/en/jobs`
- `kunsthallewien.at/en/jobs`
- `belvedere.at/karriere`
- `mak.at/jobs`
- `albertina.at/karriere/offene-stellen/`
- `leopoldmuseum.org/de/museum/team-und-kontakte/jobs`
- `mqw.at/jobs`
- `festwochen.at/jobs`

### 5. `crawl/firecrawl.ts`
- `scrape(url)` — Wrap `FirecrawlApp.scrapeUrl()` → return `{ url, markdown }`
- `crawlAggregator(platform)` — Two-step process for aggregator pages:
  1. Scrape the overview/listing page → get markdown with job titles + links
  2. Extract individual job URLs from the markdown (Claude or regex)
  3. Scrape each job detail page individually → return `{ url, markdown }[]`
- Institution career pages skip step 1 — they're scraped directly as single pages

### 6. `crawl/perplexity.ts`
- POST to `https://api.perplexity.ai/search` with model `sonar`
- Query built from profile roles + location:
  ```
  "Current job openings in Wien Austria: curatorial assistant, Kunstvermittlung,
   art mediation, project coordination, communications, social media at museums,
   galleries, Kunstvereine, cultural institutions. Include English-friendly workplaces."
  ```
- Perplexity returns results with citations/URLs
- Extract all URLs from the response via regex (`https?://[^\s"')]+`)
- Filter: skip URLs already in DB (by domain+path match), skip non-job URLs (homepage, about, etc.)
- Return new URL list → Firecrawl scrapes each one for full content
- Cost: ~$0.005 per daily query (Sonar: $1/1M input, $1/1M output, $5/1K requests)

### 7. `extract.ts`
- Takes array of `{ platform, url, markdown }`
- Batches per platform into single Claude Sonnet call
- Structured output prompt: return JSON array matching Job schema (title, title_en, company, url, location, employment_type, language_required, description, salary, deadline)
- Returns `RawJob[]`

### 8. `dedup.ts`
- Compute fingerprint: `sha256(company.toLowerCase().trim() + "|" + title.toLowerCase().trim())`
- Call `db.insertJob()` with INSERT OR IGNORE
- Return `{ inserted, skipped }` counts

### 9. `score.ts`
- First: mark expired jobs — `UPDATE jobs SET sent = 1 WHERE deadline < date('now') AND sent = 0`
- Fetch remaining unsent jobs from DB
- Single Claude Sonnet call with full `profile.json` as context
- Returns per-job: `relevance_score`, `relevance_reason`, `language_flag`
- Jobs scoring < `RELEVANCE_THRESHOLD` are marked sent (suppressed)
- Update DB

### 10. `digest.ts`
- Fetch scored unsent jobs, ordered by score DESC
- Format message per spec (emoji flags, score, title, company, location, type, reason, link)
- Print to **stdout** (no Telegram API call — OpenClaw handles delivery)
- Mark jobs as sent

### 11. `index.ts` CLI
- Use `process.argv` to dispatch: `crawl`, `score`, `digest`, `run` (all three in sequence)
- Log stage start/end + counts
- **Error handling**: Wrap each stage in try/catch. On failure, collect errors and print a summary line to stdout at the end (e.g. `"⚠️ job-claw errors: firecrawl timeout on kupf.at, perplexity 429"`) so OpenClaw can forward it. Continue with remaining stages even if one fails.

---

## Key Implementation Notes

- **Claude model**: Use `claude-sonnet-4-6` for extract + score (cost ~$0.03/day)
- **Structured output**: Use Claude's `tool_use` or JSON mode for reliable extraction
- **Error handling**: Each stage should catch + log per-platform without crashing the full run. On failure, print a short error summary to stdout so OpenClaw can forward it as a notification.
- **Perplexity**: Use `sonar` model ($1/1M tokens in+out, $5/1K requests)
- **Fingerprint**: Node built-in `crypto.createHash('sha256')`
- **No Telegram bot token needed** — OpenClaw already has Telegram connected; our script just writes to stdout

## Future Enhancements (not in v1, but slots to leave open)

- **RSS detection**: Before Firecrawl, check if a platform has an RSS/Atom feed (free + faster). Easy to add per-platform in `platforms.ts`.
- **Broader boards**: `derstandard.at/karriere`, `karriere.at` for cultural-adjacent listings.

---

## Verification

1. `npm run dev -- crawl` — scrapes 3 platforms, logs raw markdown
2. `npm run dev -- run` — full pipeline, digest printed to stdout
3. Check SQLite: `sqlite3 openclaw.db "SELECT title, relevance_score FROM jobs ORDER BY relevance_score DESC LIMIT 10"`
4. Register OpenClaw cron job pointing at our script; trigger manually via chat → Telegram message received
