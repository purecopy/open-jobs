# job-claw

Daily job crawler for Austrian cultural sector positions. Crawls job boards, extracts and scores listings via Claude, deduplicates against SQLite, and prints a ranked digest to stdout.

## Commands

All commands run from the project root (`~/projects/job-claw`).

```bash
# Build first (required before using npm start)
npm run build

# Full pipeline: crawl → score → digest (this is what cron should run)
npm start -- run

# Individual stages
npm start -- crawl    # Scrape all platforms + Perplexity discovery
npm start -- score    # Score unscored jobs, expire old ones, suppress low scores
npm start -- digest   # Print formatted digest to stdout, mark jobs as sent

# Development (uses tsx, no build needed)
npm run dev -- run
```

## Cron Integration

The `run` command is designed for OpenClaw cron. It:
1. Crawls all platforms and Perplexity
2. Scores new jobs with Claude
3. Prints the digest to **stdout** (OpenClaw reads this and sends via Telegram)
4. Prints error summary to stdout if any stage failed

### Recommended cron setup

- Schedule: daily at 8:00 AM
- Command: `cd ~/projects/job-claw && npm start -- run`
- Route stdout → Telegram DM

## Database

SQLite at `./openclaw.db` (configurable via `OPENCLAW_DB_PATH` in `.env`).

```bash
# Quick inspection
sqlite3 openclaw.db "SELECT title, company, relevance_score FROM jobs WHERE sent = 0 ORDER BY relevance_score DESC"

# Stats
sqlite3 openclaw.db "SELECT platform, count(*) FROM jobs GROUP BY platform"
```

## Environment

Requires `.env` with:
- `ANTHROPIC_API_KEY`
- `FIRECRAWL_API_KEY`
- `PERPLEXITY_API_KEY`
- `OPENCLAW_DB_PATH` (default: `./openclaw.db`)
- `RELEVANCE_THRESHOLD` (default: `3`, jobs below this are suppressed)
