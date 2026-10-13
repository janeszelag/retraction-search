# Plan 001: Data cleaning

Status: draft, 2026-10-12. Implements [spec 001](spec.md).

## Approach

Three commands make up the whole pipeline for this spec:

1. **Download** finds the latest upstream commit and saves that snapshot of the CSV, pinned by its commit.
2. **Clean** loads the snapshot, checks its columns, cleans every field, and writes the outputs: the cleaned table, the search documents, a profile report and a size report.
3. **Check** runs the invariant tests against the full local snapshot. The regular test suite runs on small committed fixtures.

```
CSV ─► load + column check ─► source (all text)
                                  │  sql/10_records.sql
                                  ▼
                               records (typed, lists, flags) ─► records.parquet
                                  │  sql/20_search_documents.sql
                                  ▼
                               documents ─► search-documents.jsonl
                                  │  sql/30_profile.sql, sql/40_size_report.sql
                                  ▼
                               profile.md, size-report.md
```

As decision record 001 requires, every transform is SQL in a `.sql` file, run by DuckDB. JavaScript only does the input and output around it: downloading, passing paths to DuckDB, running the SQL files in order, checking columns, writing files and formatting reports. The SQL files read their input path from a DuckDB variable (`getvariable('input_path')`, checked to work with `read_csv` on 2026-10-12), so each file can also be run by hand in the DuckDB CLI.

## Layout

```
package.json                  npm workspaces; root scripts call into pipeline/
pipeline/
  package.json
  sql/
    00_load.sql               read the CSV, every column as text
    10_records.sql            the cleaning rules
    20_search_documents.sql   one search document per record
    30_profile.sql            queries behind the profile report
    40_size_report.sql        queries behind the size report
  src/
    download.js               upstream commit lookup, download, manifest
    clean.js                  runs the SQL in order, writes outputs atomically
    columns.js                the 20 expected columns
    reports.js                turns query results into Markdown
    check.js                  invariants on the full local snapshot
  test/
    fixtures/
      sample.csv              about 30 real rows covering every rule
      missing-column.csv, renamed-column.csv, extra-column.csv
      README.md               why each fixture row is there
    clean.test.js
data/                         not committed
  raw/retraction_watch-<data date>-<short sha>.csv (+ .json manifest)
  clean/<data date>-<short sha>/
    records.parquet, search-documents.jsonl, profile.md, size-report.md
```

## Download (AC15)

- Ask the GitLab API for the latest commit on `main` that touches `retraction_watch.csv`. The commit title gives the data date ("Retraction Watch data for 2026-10-09").
- Download the file at that exact commit to `data/raw/retraction_watch-<data date>-<short sha>.csv`. If the file is already there and its checksum matches, skip the download.
- Write a manifest next to it with the commit SHA, data date, source URL, download time, size in bytes and SHA-256 checksum.
- `--commit <sha>` fetches a specific past snapshot, for reproducing a run or comparing days.
- The command fails if the download is empty or doesn't start with the expected header. Retries and scheduling belong to spec 003.

## Load and column check (AC3)

- `00_load.sql` reads the CSV with every column as text (`all_varchar = true`), so DuckDB guesses nothing.
- `columns.js` lists the 20 expected column names. The loader compares them with the file's columns. A missing or renamed column stops the run with an error that names it. An extra column also stops the run unless it's completely empty, which is the case for the column created by the header's trailing comma.
- The check runs before anything is written.

## Cleaning rules (`10_records.sql`)

| Output column | Type | Rule | AC |
|---|---|---|---|
| `record_id` | integer | From Record ID | AC2 |
| `title`, `journal`, `publisher` | text | Trimmed and never split; they can contain semicolons | AC9 |
| `authors`, `institutions`, `countries`, `urls`, `article_types`, `reasons` | list of text | Split on semicolons, entries trimmed, empty entries dropped, order kept. In `authors`, `institutions` and `countries`, the placeholders "Unknown", "unavailable" and "Not available" (in any capitalization) become "Unknown". | AC9 |
| `subjects` | list of (code, name) | Split like the other lists, then `(HSC) Medicine - Surgery` becomes code `HSC` and name `Medicine - Surgery`. A subject without a code gets an empty code and is listed in the profile. | AC9, AC11 |
| `notice_type` | text | RetractionNature, which must be present | AC12 |
| `notice_date`, `paper_date` | date | Parsed as month/day/year. A value that can't be parsed becomes empty and is listed in the profile. | AC6 |
| `notice_year`, `paper_year` | integer | The year of each date | AC6 |
| `notice_doi`, `paper_doi` | text | Trimmed, percent-decoded (`%3C` becomes `<`) and lowercased, with stray leading "x" characters before "10." removed. Blank and "unavailable" in any capitalization become empty. DOIs whose source text doesn't start with "10." are listed in the profile. | AC7 |
| `notice_pubmed_id`, `paper_pubmed_id` | integer | Blank and `0` become empty | AC8 |
| `paywalled` | text | Yes, No or Unknown, as Retraction Watch recorded it | AC12 |
| `is_revision` | yes/no | "Revision" appears in `article_types` | AC12 |
| `has_editorial_staff_author` | yes/no | An author contains "editorial staff", in any capitalization | AC12 |
| `notes` | text | Trimmed, empty when blank, never split | AC9 |
| `original` | group of text fields | The source text of both dates, both DOIs and both PubMed IDs, plus Author, Institution and Country for records where a placeholder was rewritten | AC4 |

The table is sorted by `record_id`.

## Search documents (`20_search_documents.sql`, AC13)

The documents are shaped for Typesense, the leading candidate. If decision record 002 picks something else, only this one SQL file changes.

- One JSON object per line, which is Typesense's import format. DuckDB writes this format directly (checked 2026-10-12).
- `id` is the record ID as text, which is what Typesense expects for document IDs.
- Dates are Unix seconds, because Typesense has no date type and its docs say to store dates as `int64` timestamps. Dates before 1970, in 49 records, become negative numbers; spec 002 needs to confirm that range filters and sorting handle them (see trade-off 6).
- Years are integers, for the year filter.
- Lists stay arrays (`string[]` in Typesense), so each reason, country or author is counted on its own.
- Subjects become two fields: `subject_categories` (the codes) and `subjects` (code and name together, such as `HSC: Medicine - Surgery`). The name alone isn't enough, because the 130 subjects have only 127 distinct names, so three names appear under two codes.
- Missing values are left out of the document rather than written as null.
- The `original` group is included so record pages can show Retraction Watch's text (AC4). It's stored with the document but not searched.
- Searchable fields: title, authors, institutions, journal and publisher. Filter fields cover everything in Goal 1: reason, subject, notice type, country, publisher, year and paywalled. `is_revision` supports hiding revisions by default.

## Profile report (`profile.md`)

1. **Snapshot:** commit, data date, rows, file size and checksum.
2. **Empty values** in every source column (AC1).
3. **Distinct values with counts** for every filter field (AC1): notice type, paywalled, reasons, subject categories, subjects, countries, article types, publishers (1,718 of them), and notice and paper years.
4. **Review lists:** unparseable dates, notices dated before their paper and records dated 1 January 1970 (AC6), DOIs whose source text doesn't start with "10." (AC7), and subjects without a code (AC11).
5. **List integrity (AC10):** for each list field, the number of list entries next to the number of non-empty semicolon-separated items in the source text. If any pair differs, the run fails rather than just reporting it.
6. **Flag counts:** revisions, editorial-staff authors and paywalled values (AC12).

## Size report (`size-report.md`, AC14)

- The total size of `search-documents.jsonl` and the number of documents.
- Bytes per field, summed over all documents and grouped into searchable, filter-only and stored-only fields (`original`, `notes`, `urls`). Decision record 002 uses this to estimate memory and disk.
- The five largest documents, which show the worst case (one record has 88 authors).

## Writing outputs (AC3, AC5)

- Outputs are first written to a temporary folder next to the final one, which is renamed only when every step has succeeded. A failed run leaves no output.
- Every output is sorted by record ID, and no output contains the run time. The run time goes to the console only.
- The AC5 test compares two runs. The JSON and Markdown files must be identical byte for byte. The Parquet file is compared by content (the same rows and values both ways), so the test doesn't depend on how the Parquet writer lays out bytes.

## Commands

These run from the repository root, through npm workspaces:

| Command | What it does |
|---|---|
| `npm install` | Installs dependencies |
| `npm run download` | Saves the latest snapshot (`-- --commit <sha>` for a specific one) |
| `npm run clean` | Cleans the newest snapshot in `data/raw` (`-- --input <file>` for another one) |
| `npm test` | Runs the fixture tests; fast, with no network or full data needed |
| `npm run check` | Runs the invariants on the full local snapshot, plus the under-a-minute timing |

The project `CLAUDE.md` gets these commands once they work.

## Tooling

Package versions were checked on npm on 2026-10-12.

- **Plain JavaScript (ES modules)**, which Node 22 runs directly, with no build step.
- **`@duckdb/node-api` 1.5.6**, the same version as the DuckDB CLI. It ships its own type definitions, so editors still autocomplete its API in JavaScript files.
- **Vitest 5** for tests. Its `describe` / `it` / `expect` API matches Jest's.

## Test approach

- **Fixtures.** `sample.csv` holds 37 real rows, picked by record ID so each can be traced back to the snapshot. Together they cover:
  - trailing semicolons
  - DOIs that contain semicolons or percent-encoding
  - DOIs that are "unavailable" or blank, and the "x10." DOIs
  - PubMed IDs of `0`
  - "Unknown" country and Unknown paywalled
  - revisions and editorial-staff authors
  - placeholder authors and institutions ("unknown", "Unavailable", "Not available")
  - the 1970 records and the notice dated before its paper
  - the record with 88 authors
  - each notice type

  The data is CC0, so committing it is fine. Three broken fixtures cover AC3, and one synthetic row covers a subject without a code.
- **One or more tests per criterion:**

| AC | Test |
|---|---|
| AC1 | The profile has the empty-values table and a value list for every filter field |
| AC2 | Row count equals source rows; record IDs are unique and never empty |
| AC3 | Each broken fixture fails with the column named, and no output folder exists afterwards |
| AC4 | Originals equal the source text for dates, DOIs and PubMed IDs |
| AC5 | Two runs give identical JSON and Markdown files and the same Parquet content |
| AC6 | Known rows get the right dates and years; the 1970 and notice-before-paper rows are listed |
| AC7 | An old-style DOI is decoded and kept whole; "Unavailable" becomes empty; the "x10." DOIs lose their x's and are listed |
| AC8 | PubMed IDs of `0` and blank become empty |
| AC9 | Lists split correctly; titles and DOIs with semicolons stay whole; placeholder entries become "Unknown" |
| AC10 | Entries equal source items for every list field, and a deliberately broken split fails the run |
| AC11 | Codes and names split; the synthetic subject without a code is listed |
| AC12 | Every record has one notice type; the flags are right on known rows |
| AC13 | Every document has the expected fields and types |
| AC14 | The size report lists the total and every field |
| AC15 | Manual check on a fresh clone: download, then clean. The download needs the network, so it isn't in the automated tests. |

- **`npm run check`** repeats AC2, AC5, AC10 and the one-notice-type rule on the full snapshot, and fails if cleaning takes a minute or more.
- **No CI yet.** Spec 003 sets up GitHub Actions. The fixture tests are written so they can run there unchanged.

## Trade-offs

1. **Originals are kept only for values the cleaning rewrites** (dates, DOIs, PubMed IDs). Lists keep every entry in order, so their source text can be rebuilt by joining entries with "; ". Storing the list fields twice would add about 44 MB, with institutions the largest part (17 MB). The exception is records where a placeholder was rewritten to "Unknown": their author, institution or country text is stored too, because it can't be rebuilt.
2. **The search documents are shaped for Typesense before decision record 002 is written.** That keeps the size report realistic, and the mapping lives in one file.
3. **JavaScript rather than TypeScript for the glue.** The logic lives in SQL and the glue is a few hundred lines, so the tests catch what type checks would. If types become worth having, `// @ts-check` with JSDoc comments adds checking without a build step.
4. **Paywalled stays Yes / No / Unknown** rather than a yes/no flag, because Unknown is information.
5. **Subjects keep their code,** because names alone aren't unique.
6. **Dates in documents are Unix seconds,** as Typesense's docs recommend. The 49 records with a date before 1970 get negative numbers; the earliest is a 1756 retraction in Philosophical Transactions. Spec 002 tests that Typesense filters and sorts them correctly. If it doesn't, dates switch to whole numbers in YYYYMMDD form (`17560624`), which sort and filter the same way and are never negative.
7. **Full-snapshot checks run only locally,** because the data isn't committed. The fixtures carry the automated tests.

## Decision record 002

The spec is done when this record exists. It gets drafted once the size report exists, and covers:

- **Engine:** Typesense, and how it supports Goal 4. Typo tolerance per field, "any of" filters and exclusion were checked in its docs on 2026-10-12.
- **Facet counts:** whether they're exact. Its docs didn't say, and the brief requires counts that match the data.
- **Memory and disk** estimated from the size report.
- **Host:** Railway or similar, with its worst-case monthly cost and how the hard limit works, checked against current pricing at that point.

## Open questions

None.
