# Spec 001: Data cleaning

Status: draft, 2026-10-12. Phase 1 of the [roadmap](../../product-brief.md#roadmap).

## Problem

The Retraction Watch CSV can't be searched or filtered as it is. Dates are strings, list fields are semicolon-separated text, and missing values are written in several different ways. The search (spec 002), the daily pipeline (spec 003) and any analysis all need the same cleaned data.

Phase 1 also prepares the search-server decision. Search will run on a server, because results show every field and running one is a learning goal. Decision record 002 picks the engine and host, and it needs to know how much data the server will hold.

## Users

- Specs 002 and 003, which build on this output.
- Researchers who pull a slice of the data for analysis (a job in the product brief), because any export comes from this cleaned data.

## Hypothesis

We believe the cleaned data, with every field, fits on a small search server whose worst-case monthly cost meets the cost guardrail. We'll know from the size report (AC14), which decision record 002 uses to choose the engine and host and to state that cost.

## Decisions

Made 2026-10-12:

- Search results show every field.
- Institutions are searchable from the start, both on their own (like the official search's Affiliation field) and together with the other fields.
- Search runs on a server. Typesense is the leading candidate, mainly for its built-in natural-language filters; decision record 002 confirms the engine and host.
- Placeholder entries in author, institution and country lists ("Unknown", "unavailable", "Not available", in any capitalization) become one value, "Unknown".
- Stray "x" characters at the start of a DOI are removed when what follows starts with "10.".

Proposed 2026-10-14, while planning [spec 003](../003-pipeline/spec.md), which builds it:

- Rows where every field is empty are dropped before cleaning and counted in the profile report (AC2). The 2026-10-09 snapshot has none, but other upstream files end with up to 317 rows of nothing but commas. Every daily file from 2026-08-18 to 2026-09-22 had them, and so did several monthly samples earlier in 2026 ([plan 003](../003-pipeline/plan.md#spikes-first), spike S1). Without this rule, the integrity check stops on them, because they have no Record ID.

## Source data

Checked 2026-10-12 against the 2026-10-09 snapshot (upstream commit `bc5648dd`).

- **Where:** `retraction_watch.csv` on the `main` branch of https://gitlab.com/crossref/retraction-watch-data. A new commit lands each working day at about 23:00 UTC, so every snapshot can be pinned by its commit. The repository's README documents the columns.
- **Size:** 67.4 MB and 73,100 rows. Record ID is numeric, unique and never empty.
- **Columns:** the 20 that the README lists. The header ends with a comma, so parsers also see an extra, always-empty 21st column.

| Field | What the data looks like |
|---|---|
| RetractionNature | Retraction 67,663; Expression of concern 3,731; Correction 1,543; Reinstatement 163 |
| Paywalled | No 71,233; Yes 1,640; Unknown 227 |
| Dates | `M/D/YYYY 0:00`, and all of them parse. They run from 1753 to 2026. 1,960 records give the paper and the notice the same date, and one has the notice dated before the paper. Six records, sections of one 1970 book, are dated 1 January 1970 for both; Crossref stores that notice date as timestamp 0, so it's almost certainly a placeholder. |
| DOIs | Missing DOIs are blank, "unavailable" or "Unavailable": 3,426 unavailable and 2,523 blank for original papers, 4,186 and 484 for notices. None have URL prefixes. Old-style DOIs contain semicolons and percent-encoded characters (`%3C` for `<`). Two notice DOIs start with a stray "x" or "xx". Three chapters of one book share a notice; one record has its DOI written cleanly, and the x's appear to keep each record's notice DOI unique. |
| PubMed IDs | Missing IDs are blank or `0`. All others are numeric. |
| List fields | Author, Country, Institution, Subject, Reason, ArticleType and URLS are semicolon-separated. Subject, Reason and ArticleType always end with a semicolon. Title, Journal, the DOIs and Notes can contain semicolons but aren't lists. |
| Reason | 112 distinct values |
| Subject | 130 distinct values, each starting with one of seven codes: BLS, HSC, B/T, PHY, SOC, ENV, HUM |
| Country | 184 distinct values, including "Unknown" (958 records) |
| ArticleType | 26 distinct values. 279 records include "Revision". |
| Author | 4.2 per record on average, up to 88. Seven records use an "Editorial Staff" placeholder, written in different ways ("Editorial Staff PLoS One", "Frontiers Editorial Staff"). 117 records list "Unknown" or "unknown" as the author. |
| Institution | 2.4 per record on average, up to 47. The largest field: 16.9 MB of the file's 66 MB of text. 885 records hold a placeholder instead of an institution, written six ways: Unknown (405), unavailable (298), Unavailable (143), unknown (23), Not available (15), Not Available (1). |
| Notes | Free text, filled in for 20,860 records. Some notes mark estimated dates ("HTML overwrite"). |

The [data caveats](../../product-brief.md#data-caveats) in the product brief also apply.

## Acceptance criteria

Every criterion is checked against one pinned snapshot.

**Profiling**

- AC1: A profile report lists the number of empty values in every column. For every field that becomes a filter, it also lists each distinct value with its count.

**Integrity**

- AC2: Source rows where every field is empty are dropped, and the profile report gives their number (proposed change, 2026-10-14). The cleaned data has exactly one row per remaining source row. Record ID is unique and never empty.
- AC3: If one of the 20 expected columns is missing or renamed, or an unexpected column contains data, cleaning stops with an error that names the column and writes no output. The always-empty column created by the header's trailing comma is ignored.
- AC4: For every field the cleaning changes, the original value stays available next to the cleaned one, so record pages can show what Retraction Watch published.
- AC5: Running the cleaning twice on the same input produces identical output.

**Field rules**

- AC6: The retraction date and the original-paper date become real dates, each with a year for filtering. A value that can't be parsed becomes empty and is listed in the profile report. Records whose notice is dated before the paper are listed too, and so are records dated exactly 1 January 1970, a common placeholder for a missing date in software.
- AC7: DOIs are lowercase, with percent-encoded characters decoded and no surrounding spaces. Blank values and "unavailable" in any capitalization become empty. Stray "x" characters before "10." are removed. DOIs whose source text doesn't start with "10." are listed in the profile report.
- AC8: PubMed IDs that are blank or `0` become empty.
- AC9: Author, Country, Institution, Subject, Reason, ArticleType and URLS become lists. They're split on semicolons, entries are trimmed, empty entries are dropped, and author order is kept. Title, Journal, the DOIs and Notes are never split. In Author, Institution and Country, the placeholders "Unknown", "unavailable" and "Not available", in any capitalization, become one value, "Unknown", so Retraction Watch's "we don't know" stays visible in a single spelling.
- AC10: Splitting loses and invents nothing: for each list field, the number of list entries equals the number of non-empty semicolon-separated items in the raw text.
- AC11: Each subject splits into its code and its name. Subjects without a code are listed in the profile report.
- AC12: Every record has exactly one notice type and three flags: whether it's a revised version ("Revision" in its article types), whether an author is an "Editorial Staff" placeholder (in any of its forms), and whether its notice is paywalled (yes, no or unknown).

**Search documents**

- AC13: Each record becomes one search document holding every field, ready to load into a search engine. Title, authors, institutions, journal and publisher are searchable, and every filter in Goal 1 of the product brief has a field to filter on.
- AC14: A size report gives the total size of the search documents and the size of each field, so decision record 002 can estimate the server's memory and disk needs.

**Running it**

- AC15: One command downloads a snapshot into `data/`, pinned by its upstream commit. One command runs the cleaning on it.

## Done when

All acceptance criteria pass, and decision record 002 is drafted: which search engine or backend, where it's hosted, its worst-case monthly cost, and how it supports the field search in Goal 4 of the product brief.

## Success metrics

- Nothing is unexplained: every value that couldn't be parsed or classified appears in the profile report with its count.
- The cleaning runs in under a minute on a laptop. It should take seconds; the limit only catches pathological slowdowns.

## Non-goals

- Scheduled downloads, day-to-day diffs and publishing (spec 003).
- The search UI and the search server itself (spec 002).
- Normalizing institutions (for example against ROR), publishers or author names.
- Enrichment from other sources, such as abstracts, references or citations.

## Open questions

None at the moment.
