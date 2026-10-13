# Tasks 001: Data cleaning

Status: in progress, 2026-10-12. Follows [plan 001](plan.md). Work one task at a time, and tick a task off once its "done when" check passes.

- [x] **1. Set up the workspace.** A root `package.json` with npm workspaces, and `pipeline/package.json` (ES modules) with `@duckdb/node-api` 1.5.6 and Vitest 5, plus the `test` script. The `download`, `clean` and `check` scripts arrive with the tasks that build them (2, 4 and 11). A first test opens DuckDB in memory and runs `SELECT 1`.
  - Done when: `npm install` and `npm test` pass from the repository root.

- [ ] **2. Download command.** `src/download.js` gets the latest commit from the GitLab API, downloads the file at that commit and writes a manifest with its SHA-256 checksum. It supports `--commit`, skips the download when the checksum already matches, and fails on an empty file or a wrong header. (AC15)
  - Done when: `npm run download` saves the latest snapshot and its manifest, a second run skips the download, and `-- --commit bc5648dd` fetches the 2026-10-09 file.

- [ ] **3. Fixtures.** `test/fixtures/sample.csv` holds about 30 real rows chosen by record ID, and `README.md` explains why each one is there. Add the three broken files (missing, renamed, and extra column with data) and one synthetic row whose subject has no code. (Inputs for AC3 and AC6–AC13)
  - Done when: every case in the plan's fixture list has at least one row, and the README names it.

- [ ] **4. Load and column check.** Write `sql/00_load.sql`, `src/columns.js` and the start of `src/clean.js`: load every column as text, compare the columns with the expected 20, and allow an extra column only if it's empty. (AC3)
  - Done when: tests show each broken fixture fails with the column named, and `sample.csv` loads.

- [ ] **5. Cleaning: dates, identifiers and originals.** The first part of `sql/10_records.sql`: record ID, dates and years, DOIs, PubMed IDs and the `original` group. (AC2, AC4, AC6, AC7, AC8)
  - Done when: tests pass for one row per source row, unique IDs, parsed dates and years, decoded lowercase DOIs, placeholders becoming empty, and originals matching the source text.

- [ ] **6. Cleaning: lists, subjects, notice type and flags.** The rest of `10_records.sql`: the seven list fields, subject codes and names, notice type, paywalled, `is_revision`, `has_editorial_staff_author` and notes. (AC9, AC10, AC11, AC12)
  - Done when: tests pass for list splitting (trailing semicolons, titles and DOIs staying whole, "Unknown" kept), entry counts matching source items, a deliberately broken split failing the run, subject splitting, and the flags on known rows.

- [ ] **7. Search documents.** `sql/20_search_documents.sql` and the JSON-lines writer produce a text `id`, dates in Unix seconds, years, arrays, subject categories, subjects with their codes, and the `original` group, leaving missing values out. (AC13)
  - Done when: tests show every document has the expected fields and types, and no null values.

- [ ] **8. Profile report.** `sql/30_profile.sql` and `src/reports.js` produce the report's six sections: snapshot details, empty values, values with counts for every filter field, review lists, list integrity and flag counts. (AC1, AC6, AC7, AC10, AC11, AC12)
  - Done when: tests find each section, and the fixture rows that need review are listed.

- [ ] **9. Size report.** `sql/40_size_report.sql` gives the total size and document count, bytes per field grouped as searchable, filter-only and stored-only, and the five largest documents. (AC14)
  - Done when: a test finds the total and a line for every document field.

- [ ] **10. Safe, repeatable output.** Write to a temporary folder and rename it on success, sort everything by record ID, and keep run times out of the files. (AC3, AC5)
  - Done when: tests show a failed run leaves no output folder, and two runs give identical JSON and Markdown files and the same Parquet content.

- [ ] **11. Full-snapshot check.** `src/check.js` and `npm run check` repeat AC2, AC5, AC10 and the one-notice-type rule on the latest local snapshot, and time the run. (AC2, AC5, AC10, AC12, success metrics)
  - Done when: `npm run check` passes on the 2026-10-09 snapshot in under a minute, and the profile report's numbers match the spec's "Source data" table or the differences are explained.

- [ ] **12. End-to-end on a fresh clone.** Clone the repository into a temporary folder, then run `npm install`, `npm run download`, `npm run clean` and `npm run check`. Add the commands to `CLAUDE.md`. (AC15)
  - Done when: all four commands succeed in the fresh clone, and `CLAUDE.md` lists them.

- [ ] **13. Decision record 002.** `docs/decisions/002-search-engine.md` covers how Typesense supports Goal 4, whether its facet counts are exact, memory and disk estimated from the size report, and Railway's current pricing, hard limit and worst-case monthly cost.
  - Done when: the record is drafted for review. That completes the spec, and spec 001 goes up as a pull request.
