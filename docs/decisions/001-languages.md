# 001: SQL and JavaScript for the pipeline, TypeScript for the frontend

Status: proposed, 2026-10-12. The pipeline glue changed from TypeScript to JavaScript the same day.

## Context

- The owner works mainly in JavaScript/TypeScript (Next.js) and SQL (BigQuery), hasn't built a data pipeline before, and wants to learn data-science tooling.
- The early data work is tabular cleaning of one CSV of about 65 MB: parsing dates, splitting delimited fields, normalizing DOIs. DuckDB does this in SQL, whichever language calls it.
- Python's ecosystem is stronger for some later candidates, such as embeddings and affiliation matching.

## Decision

- **Frontend:** Next.js (React) written in TypeScript.
- **Data transforms:** SQL in `.sql` files, run by DuckDB. Keeping SQL out of JavaScript strings means every query can also run directly in the DuckDB CLI.
- **Pipeline glue** (download, run SQL, diff, validate, write outputs): JavaScript (ES modules) on Node 22, using `@duckdb/node-api`. Node runs it directly, with no build step. As of 2026-10-12, `@duckdb/node-api` is at 1.5.6 on npm, the same version as the DuckDB CLI in Homebrew. The older `duckdb` npm package is at 1.4.4.
- **Pipeline steps hand off files** (Parquet), so a step can be rewritten in another language without changing the others.
- **Python is allowed** for exploration notebooks that nothing depends on, and for a pipeline step when a later decision record shows it's clearly better.

## Alternatives considered

- **TypeScript for the pipeline glue too.** It would give type checks across the whole repo. But the glue is a few hundred lines around SQL, and running TypeScript needs either a runner or Node's built-in support, which requires `.ts` in every import. That's setup for little benefit.
- **Python for all pipeline code.** A stronger data ecosystem, but two toolchains from the start, for steps that are mostly SQL anyway.
- **DuckDB CLI and shell scripts only.** The least code, but diffing, validation and error handling are awkward in shell and hard to test.

## Consequences

- One toolchain (Node and npm) covers the app, pipeline, tests and CI at the start.
- The SQL files are the source of truth for cleaning logic.
- The pipeline has no type checking, so the tests carry that weight. `@duckdb/node-api` ships its own type definitions, so editors still autocomplete it. If types become worth having, `// @ts-check` with JSDoc comments adds checking without changing language.
- Embeddings don't force a move to Python: transformers.js runs in Node and in the browser, so documents and queries could use the same model. Revisit if it's too slow or lacks a suitable model.
- Adding Python later needs a new decision record covering its environment and how it runs in CI.
