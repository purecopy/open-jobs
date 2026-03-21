# Plan: Add retry resilience for Anthropic API overloaded errors

## Context
First crawl completed successfully (66 jobs from 151 pages), but several platforms lost jobs due to Anthropic API 529 overloaded errors. The SDK already retries 5xx errors (including 529) with exponential backoff, but the default `maxRetries: 2` isn't enough during peak load.

## Approach
Increase `maxRetries` on the Anthropic client in both files where it's instantiated. This is a one-line change in each file — no custom retry logic needed since the SDK handles backoff correctly.

### Files to modify
- **`src/extract.ts:26`** — `new Anthropic({ apiKey, maxRetries: 5 })`
- **`src/score.ts:26`** — `new Anthropic({ apiKey, maxRetries: 5 })`

`maxRetries: 5` gives 6 total attempts with exponential backoff, which should handle transient overload windows.

## Verification
1. `npx tsc --noEmit` — type check
2. `npm exec -- ultracite check` — lint
3. Run `npm run dev -- run` to do a full pipeline (crawl + score + digest) and confirm fewer/no overloaded errors
