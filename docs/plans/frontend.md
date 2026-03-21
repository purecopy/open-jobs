# Job-Claw Frontend Plan

## Context
job-claw is a CLI tool that crawls Austrian cultural job boards into Cloudflare D1 and scores them with Claude. There's no way to browse the data except querying D1 directly. We need a web frontend to display, sort, and filter the jobs table.

## Decision: Separate Repo (`job-claw-web`)

**Why not same repo / monorepo:**
- Root `biome.jsonc` uses the ultracite preset; Astro needs different Biome configuration (`.astro` file support). Nested configs are fragile.
- Root `tsconfig.json` targets Node.js ES2022. Astro/Cloudflare Workers needs different lib/module targets — two tsconfigs in one repo with `include` juggling is messy.
- CLI runs on Node.js; web runs on Cloudflare Workers edge runtime. Separation prevents accidental Node-only imports bleeding into the web build.
- Cloudflare Pages deployment is simpler from a repo root (no `cd web &&` prefix, no subdirectory output path).

**Shared artifact:** Only the `Job` interface (~20 lines). Copied into `src/lib/types.ts` in the new repo. If the D1 schema changes (rare), update both manually — it's a type, not runtime logic.

**New repo:** `job-claw-web` — Cloudflare Pages deploys from root.

## Stack
- **Astro 5** with `@astrojs/cloudflare` adapter (SSR on Cloudflare Pages)
- **React 19** via `@astrojs/react`
- **HeroUI v3 beta** (`@heroui/react`) — compound Table component as rendering layer
- **TanStack Table v8** (`@tanstack/react-table`) — headless data logic (sort, filter, pagination state)
- **Tailwind CSS v4** via `@tailwindcss/vite` + HeroUI theme plugin
- **D1 native binding** (not REST API — Pages binds D1 directly, no API token needed)

## File Structure (`job-claw-web` repo)

```
job-claw-web/
  package.json
  astro.config.mjs
  wrangler.jsonc           ← D1 binding config (binding name: DB)
  tsconfig.json
  biome.jsonc              ← fresh Biome config (no ultracite, supports .astro)
  src/
    env.d.ts              ← D1Database type augmentation
    styles/global.css     ← @import "tailwindcss" + @plugin "@heroui/theme"
    layouts/Base.astro    ← HTML shell, mounts AppProviders island
    pages/
      index.astro         ← renders JobTable as React island
      api/jobs.ts         ← GET /api/jobs — queries D1 with sort/filter/pagination
    lib/
      types.ts            ← Job interface (copied from job-claw/src/db.ts)
      queries.ts          ← SQL builder: WHERE, ORDER BY, LIMIT/OFFSET
    components/
      AppProviders.tsx    ← HeroUIProvider wrapper (client:load on Base.astro)
      JobTable.tsx        ← TanStack Table state + HeroUI Table rendering (client:load)
      JobCard.tsx         ← HeroUI Card, mobile layout for a single job
      Filters.tsx         ← HeroUI Input + Select + Drawer for filter controls
```

## Implementation Steps

### Step 1: Create new repo and copy type
- `gh repo create job-claw-web --private` (or init locally)
- Copy `Job` interface from `job-claw/src/db.ts` into `src/lib/types.ts`

### Step 2: Scaffold Astro project
```
npm create astro@latest . -- --template minimal
npm install @astrojs/cloudflare @astrojs/react react react-dom @heroui/react @tanstack/react-table framer-motion
npm install -D tailwindcss @tailwindcss/vite wrangler @types/react @types/react-dom
```

Configure `astro.config.mjs`:
- `output: "server"` (SSR for D1 access)
- `adapter: cloudflare({ platformProxy: { enabled: true } })` (local D1 dev)
- `integrations: [react()]`
- `vite: { plugins: [tailwindcss()] }`
- `vite.ssr.noExternal: ["@heroui/react", "framer-motion"]` (prevent SSR bundling issues)

Configure `wrangler.jsonc` with D1 binding (`DB`).

Configure `styles/global.css` with HeroUI plugin:
```css
@import "tailwindcss";
@plugin "@heroui/theme";
```

Wrap layout root with `HeroUIProvider` in `layouts/Base.astro` (inside a React island or via a wrapper component — HeroUI requires client-side context).

### Step 3: API route — `pages/api/jobs.ts`
**GET /api/jobs** with query params:
| Param | Example | Description |
|-------|---------|-------------|
| `page` | `1` | Page number (1-indexed) |
| `pageSize` | `25` | Rows per page (max 100) |
| `sort` | `relevance_score` | Column name (allowlisted) |
| `order` | `desc` | `asc` or `desc` |
| `search` | `curator` | LIKE search on title, title_en, company |
| `platform` | `mumok` | Exact match filter |
| `employment_type` | `full-time` | Exact match filter |
| `language_flag` | `green` | Exact match filter |
| `minScore` | `5` | Minimum relevance_score |

**`lib/queries.ts`** builds parameterized SQL:
- Allowlist of sortable columns to prevent injection
- `?` bindings for all filter values
- `LIMIT ? OFFSET ?` for pagination
- Parallel `SELECT COUNT(*)` for total count

**Response:**
```ts
{ data: Job[], page: number, pageSize: number, total: number }
```

### Step 4: Build components

All UI components use **HeroUI v3** (`@heroui/react`). TanStack Table provides headless state; HeroUI renders it.

**`JobTable.tsx`** — Main component (React island with `client:load`)
- `useReactTable` with `manualSorting`, `manualFiltering`, `manualPagination`
- HeroUI `Table` compound components for rendering:
  ```tsx
  import { Table, Pagination, Spinner, Chip, Input, Select } from "@heroui/react"
  // Table.Content sortDescriptor + onSortChange synced with TanStack sort state
  // Table.Header / Table.Column (allowsSorting) / Table.Body / Table.Row / Table.Cell / Table.Footer
  ```
- Fetches from `/api/jobs` on sort/filter/page changes
- State stored in URL search params (bookmarkable)
- Columns: Score, Title, Company, Platform, Location, Type, Language, Posted, Deadline

**`JobCard.tsx`** — Mobile card view (HeroUI `Card` component)
- HeroUI `Card`, `CardHeader`, `CardBody`, `CardFooter`
- Shows title, company, score chip, platform, deadline
- Tap to expand description/reason or open URL

**`Filters.tsx`** — Filter controls (HeroUI `Input` + `Select`)
- `Input` with debounce for title/company text search
- `Select` dropdowns for platform, employment_type, language_flag
- `Slider` or `Input type="number"` for min score
- Mobile: HeroUI `Drawer` (collapsible); Desktop: inline top bar

**Score display** — HeroUI `Chip` (replaces custom ScoreBadge)
- `color="danger"` for 1-3, `color="warning"` for 4-6, `color="success"` for 7-10

**Pagination** — HeroUI `Pagination` component inside `Table.Footer`
- `total`, `page`, `onChange` props; page size via `Select`

### Step 5: Mobile-first responsive design

**Mobile (default):** Card list layout. Each job is a `JobCard`. Filter icon button opens drawer.

**Desktop (lg: 1024px+):** Full table with sortable column headers, all columns visible, hover states. Filters inline above table.

Implementation: Render both layouts, toggle with Tailwind `hidden lg:block` / `lg:hidden`. TanStack Table provides the data model for both views.

### Step 6: Deploy to Cloudflare Pages
- Connect `job-claw-web` repo to Cloudflare Pages
- Build command: `npm run build`
- Output directory: `dist/`
- Add D1 binding in Pages dashboard (binding name: `DB`, select existing database)

## Platform filter values
From `src/crawl/platforms.ts`: `kulturkonzepte`, `kupf`, `igkultur`, `mumok`, `kunsthalle-wien`, `belvedere`, `mak`, `albertina`, `leopold-museum`, `museumsquartier`, `festwochen`, plus `perplexity` for AI-discovered jobs.

## Verification
1. `npm run dev` — Astro dev server starts
2. Seed local D1 with `wrangler d1 execute` using test data
3. Visit `http://localhost:4321` — table renders with data
4. Test sorting by clicking column headers
5. Test filtering with search and dropdowns
6. Test pagination with prev/next
7. Resize browser to verify mobile card layout vs desktop table
8. `npm run build` — builds without errors
9. Deploy to Cloudflare Pages and verify D1 binding works
