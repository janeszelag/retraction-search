# 001: TypeScript and SQL, with Python optional

Status: proposed, 2026-10-12

## Context

- The owner works mainly in JavaScript/TypeScript (Next.js) and SQL (BigQuery), hasn't built a data pipeline before, and wants to learn data-science tooling.
- The early data work is tabular cleaning of one CSV of about 65 MB: parsing dates, splitting delimited fields, normalizing DOIs. DuckDB does this in SQL, whichever language calls it.
- Python's ecosystem is stronger for some later candidates, such as embeddings and affiliation matching.

## Decision

- **Frontend:** Next.js with TypeScript.
- **Data transforms:** SQL in `.sql` files, run by DuckDB. Keeping SQL out of TypeScript strings means every query can also run directly in the DuckDB CLI.
- **Pipeline glue** (download, run SQL, diff, validate, write outputs): TypeScript on Node 22, using `@duckdb/node-api`. As of 2026-10-12 it's at 1.5.6 on npm, the same version as the DuckDB CLI in Homebrew. The older `duckdb` npm package is at 1.4.4.
- **Pipeline steps hand off files** (Parquet), so a step can be rewritten in another language without changing the others.
- **Python is allowed** for exploration notebooks that nothing depends on, and for a pipeline step when a later decision record shows it's clearly better.

## Alternatives considered

- **Python for all pipeline code.** A stronger data ecosystem, but two toolchains from the start, for steps that are mostly SQL anyway.
- **DuckDB CLI and shell scripts only.** The least code, but diffing, validation and error handling are awkward in shell and hard to test.

## Consequences

- One toolchain (Node and npm) covers the app, pipeline, tests and CI at the start.
- The SQL files are the source of truth for cleaning logic.
- Embeddings don't force a move to Python: transformers.js runs in Node and in the browser, so documents and queries could use the same model. Revisit if it's too slow or lacks a suitable model.
- Adding Python later needs a new decision record covering its environment and how it runs in CI.
