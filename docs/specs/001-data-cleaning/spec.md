# Spec 001: Data cleaning

Status: draft, 2026-10-12. Phase 1 of the [roadmap](../../product-brief.md#roadmap). AC4, AC6, AC8, AC9 and AC10 changed for upstream's second export with the owner's approval, 2026-10-25, and AC9 and AC10 again for an Institution written `None`, at the owner's request the same day (see Decisions).

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

Agreed 2026-10-14, while planning [spec 003](../003-pipeline/spec.md), which builds it:

- Rows where every field is empty are dropped before cleaning and counted in the profile report (AC2). The 2026-10-09 snapshot has none, but other upstream files end with up to 317 rows of nothing but commas. Every daily file from 2026-08-18 to 2026-09-22 had them, and so did several monthly samples earlier in 2026 ([plan 003](../003-pipeline/plan.md#spikes-first), spike S1). Without this rule, the integrity check stops on them, because they have no Record ID.

Agreed 2026-10-25, for upstream's second export. [Spec 003](../003-pipeline/spec.md) builds it, and [plan 003](../003-pipeline/plan.md#upstreams-second-export) has the measurements:

- Since 2026-10-15, upstream has published some of its files from a second export. The first ones were in Windows-1252 and had lost text, so they never loaded (spec 003, AC22). The 2026-10-22 and 2026-10-23 files come from the same export in UTF-8, with no text lost, so they should load. But the export writes values differently, and four of the differences would stop the cleaning or quietly change the data. Each gets a rule:
  - **Line breaks and repeated spaces.** In the 2026-10-23 file, line breaks follow most semicolons in Institution (40,128 records) and appear in Notes (1,324 records). Double spaces appear in 1,982 values, such as 424 author fields and 242 journals; the 2026-10-16 file has 98. Every run of spaces, tabs and line breaks becomes one space (AC9). Without this rule, institution entries keep a leading line break, the integrity check stops on three records whose institutions include an item that is only a line break (AC10), and a journal written with a double space becomes a second journal in the filters.
  - **Line breaks inside an institution entry.** There are 2,186 in 1,321 records. Most start a new affiliation, but roughly one in twenty falls inside one, as when "Lanzhou" ends one line and "University" starts the next. So a line break never splits a list. It becomes a space, which is how the first export writes it.
  - **PubMed IDs written `00000000`** instead of `0`: 34,799 notice IDs and 33,810 paper IDs. Without a rule they'd become the PubMed ID 0 (AC8).
  - **A second date form.** Record 18930 has the two earliest dates, a 1753 paper and its 1756 notice. Both are written `M/D/YYYY 12:00:00 AM`, as the 2026-10-15 file wrote every date. Without a rule they'd become empty (AC6). Upstream's own issue tracker has reported this date form for the same record since 2026-03-02 ([issue 2](https://gitlab.com/crossref/retraction-watch-data/-/issues/2), open on 2026-10-25).
- Changes to whitespace alone aren't kept in `original` (AC4), just as trimming isn't today. The first export has no line breaks, so the site has never shown any.
- **An Institution written `None`** (agreed 2026-10-25, at the owner's request, after the code above was built). Record 34181 has no institution. Every file of the second export writes its Institution as `None` (2026-10-15, 2026-10-21, 2026-10-22 and 2026-10-23), and so did the first export's 2026-09-22 file, but its 2026-10-08 to 2026-10-16 files leave it empty. No other record in those files has an Institution of `None`, in any capitalization. Without a rule, the record would list an institution called "None", and the diff would count every switch as a change. An Institution that is exactly `None` is empty (AC9), as the site shows the record today. The published text stays in `original` (AC4), as for any value the cleaning changes, and the profile report counts these records. Other columns don't have the value, and `None` inside a longer institution list is kept.

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

Upstream's second export, seen since 2026-10-15, has the same 20 columns but writes some values differently: see Decisions (2026-10-25) and [data issues](../../data-issues.md#file-format).

The [data caveats](../../product-brief.md#data-caveats) in the product brief also apply.

## Acceptance criteria

Every criterion is checked against one pinned snapshot.

**Profiling**

- AC1: A profile report lists the number of empty values in every column. For every field that becomes a filter, it also lists each distinct value with its count.

**Integrity**

- AC2: Source rows where every field is empty are dropped, and the profile report gives their number (changed 2026-10-14). The cleaned data has exactly one row per remaining source row. Record ID is unique and never empty.
- AC3: If one of the 20 expected columns is missing or renamed, or an unexpected column contains data, cleaning stops with an error that names the column and writes no output. The always-empty column created by the header's trailing comma is ignored.
- AC4: For every field the cleaning changes, the original value stays available next to the cleaned one, so record pages can show what Retraction Watch published. Changes to whitespace alone (AC9) aren't kept (changed 2026-10-25).
- AC5: Running the cleaning twice on the same input produces identical output.

**Field rules**

- AC6: The retraction date and the original-paper date become real dates, each with a year for filtering. Dates written `M/D/YYYY H:MM` and `M/D/YYYY h:mm:ss AM` both parse (changed 2026-10-25). A value that can't be parsed becomes empty and is listed in the profile report. Records whose notice is dated before the paper are listed too, and so are records dated exactly 1 January 1970, a common placeholder for a missing date in software.
- AC7: DOIs are lowercase, with percent-encoded characters decoded and no surrounding spaces. Blank values and "unavailable" in any capitalization become empty. Stray "x" characters before "10." are removed. DOIs whose source text doesn't start with "10." are listed in the profile report.
- AC8: PubMed IDs that are blank or made only of zeros, such as `0` and `00000000`, become empty (changed 2026-10-25).
- AC9: Author, Country, Institution, Subject, Reason, ArticleType and URLS become lists. They're split on semicolons, entries are trimmed, empty entries are dropped, and author order is kept. Title, Journal, the DOIs and Notes are never split. In Author, Institution and Country, the placeholders "Unknown", "unavailable" and "Not available", in any capitalization, become one value, "Unknown", so Retraction Watch's "we don't know" stays visible in a single spelling.
  - Changed 2026-10-25: an Institution that is exactly `None`, once its whitespace is collapsed, is empty: the record has no institutions. The profile report gives the number of such records.
  - Changed 2026-10-25: in titles, journals, publishers, notes and list entries, every run of spaces, tabs and line breaks becomes one space, and any at the start or end is removed. An entry left with nothing counts as empty. A line break never splits a list. The profile report gives, for each column, the number of values whose whitespace changed.
- AC10: Splitting loses and invents nothing: for each list field, the number of list entries equals the number of semicolon-separated items in the raw text that hold something besides spaces, tabs and line breaks (changed 2026-10-25). An Institution of exactly `None` has no items (changed 2026-10-25).
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
