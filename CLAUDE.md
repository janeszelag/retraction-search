# Retraction search

A faceted public search over the Retraction Watch database, rebuilt daily from the open CSV. Why it exists, who it's for and how success is measured: [docs/product-brief.md](docs/product-brief.md).

## Hard constraints

- **No uncapped bills.** Fixed monthly costs are fine. Anything billed by usage needs a hard spending cap enforced by the provider; budget alerts that only notify don't count. Don't add a paid API, LLM call or hosted service without a decision record that states its worst-case monthly cost.
- **Attribution.** The data is CC0: the Retraction Watch database, distributed by Crossref at https://gitlab.com/crossref/retraction-watch-data. Every page credits Retraction Watch and links the source. Never imply affiliation with either.
- **Author names are not identities.** Names aren't disambiguated. Label author matches as name matches, and don't build per-author counts, rankings or profiles.
- **Report, don't allege.** Show what Retraction Watch recorded, and label reasons as Retraction Watch's classification. Keep the notice types (retraction, expression of concern, correction, reinstatement) visibly distinct.
- **Keys stay on the server.** Browsers never receive a Typesense or LLM key. Every search goes through the website's server code, and each visitor's requests are rate-limited: by a Vercel firewall rule for now, and by the server code's own limits before any LLM call (decision record 005).
- **Verify external facts.** Prices, API behavior, data counts and other tools' features change. Check the live source before putting a fact in docs or code, note the date checked, and mark anything unchecked as unverified.

## Stack

See decision records [001](docs/decisions/001-languages.md) (languages), [002](docs/decisions/002-search-engine.md) (search) and [003](docs/decisions/003-ui-stack.md) (UI).

- Frontend: Next.js (React) written in TypeScript.
- UI: Tailwind CSS 4, with Radix Primitives only where native HTML falls short. The search page is a server component, and the URL holds the whole query.
- Search: Typesense 30.2 on Railway (Hobby plan, $50 hard limit), reached only through the website's server code.
- Data transforms: SQL run by DuckDB, kept in `.sql` files.
- Pipeline glue: JavaScript (ES modules) on Node 22, using `@duckdb/node-api`. No build step.
- Python: only for exploration notebooks, or for a pipeline step that a decision record approves.

## How we work: lightweight spec-driven development

| File | Purpose |
|---|---|
| `docs/product-brief.md` | Why, users, success metrics, non-goals. Changes rarely. |
| `docs/decisions/NNN-title.md` | One decision each: context, decision, alternatives, consequences. |
| `docs/specs/NNN-feature/spec.md` | What and why: problem, users, hypothesis, acceptance criteria with IDs (AC1, AC2…), success metrics, non-goals, open questions. No implementation detail. |
| `docs/specs/NNN-feature/plan.md` | How: approach, data model, trade-offs, test approach. |
| `docs/specs/NNN-feature/tasks.md` | Ordered checklist. Each task is small, testable and tagged with the AC it serves. |

Rules:

1. No code without an approved `spec.md` and `plan.md`.
2. Work one task at a time, and tick it off in `tasks.md` when it's done.
3. Every acceptance criterion has an automated test, or a written manual check where a test isn't practical.
4. If the code needs to differ from the spec, stop and propose a spec change before continuing.
5. Raw downloads and pipeline outputs live in `data/` and are never committed.

## Layout (planned)

- `pipeline/`: DuckDB SQL and JavaScript glue
- `web/`: Next.js app
- `data/`: local downloads and outputs (not committed)
- `docs/`: brief, decisions, specs, and the [data issues](docs/data-issues.md) found so far

## Commands

Run from the repository root:

| Command | What it does |
|---|---|
| `npm install` | Installs dependencies |
| `npm test` | Runs the pipeline and web tests (Vitest) on the committed fixtures; needs no network or full data |
| `npm run download` | Saves the latest snapshot to `data/raw/`, pinned by its upstream commit (`-- --commit <sha>` for a specific one) |
| `npm run clean` | Cleans the newest snapshot into `data/clean/<data date>-<short sha>/` (`-- --input <file>` for another) |
| `npm run check` | Cleans the newest snapshot twice and checks the outputs (`-- --input <file>` for another) |
| `npm run diff -- --from <csv> --to <csv>` | Compares two downloaded snapshots by Record ID and writes `diff.json` and `diff.md` to `data/diff/` |
| `npm run search:up` | Starts Typesense and Redis in Docker, with the keys from `.env.local` (copy `.env.example` to make one) |
| `npm run search:down` | Stops them |
| `npm run load` | Loads the newest cleaned snapshot into Typesense (`-- --input <folder>` for another) and saves the site's key to `.env.local` |
| `npm run update` | Brings the Typesense server in `.env.local` up to the newest upstream snapshot: downloads, cleans, diffs, loads and switches, with spec 003's checks, and writes `data/runs/<time>/summary.md`. `-- --force` reloads, `-- --commit <sha>` loads a given snapshot, `-- --accept-changes` lets one run past the change limits, and `-- --server-env <file>` targets another server. Never touches keys |
| `npm run web` | Starts the site at http://localhost:3000 |
| `npm run check:search` | Compares the site's searches, counts and download with DuckDB on the loaded snapshot; needs the local stack |
| `npm run test:e2e` | Builds the site and runs the browser tests (Playwright, with axe) in the installed Google Chrome; needs the local stack |
| `npm run check:speed` | Builds the site, times the server response for a fixed set of searches and runs Lighthouse's mobile test; needs the local stack |

The SQL files in `pipeline/sql/` also run in the DuckDB CLI: `SET VARIABLE input_path = '<csv file>';`, then `.read` the files in order.
