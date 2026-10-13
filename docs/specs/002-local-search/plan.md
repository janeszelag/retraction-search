# Plan 002: Local search MVP

Status: draft, 2026-10-13. How to build [spec 002](spec.md). Decision records [002](../../decisions/002-search-engine.md) (Typesense on Railway) and [003](../../decisions/003-ui-stack.md) (Tailwind, headless components, URL-driven search) apply.

Typesense behavior cited here was checked on 2026-10-13 against the docs for version 30.0, the newest docs version; the server runs 30.2. The spikes below confirm the parts that matter on the real server.

## Design

Chosen from three interactive prototypes built on the 2026-10-09 snapshot: the layout with a filter sidebar. The prototypes aren't committed; this section records what they settled.

![The default search page in the chosen prototype, 1024 pixels wide](design/search-default.jpg)

**Layout**

- A header in two columns: the site name and data date above the filter column, and the search box above the results, aligned with them.
- A 340 px filter sidebar. From top to bottom: notice type; including revised versions; reason; subject; country; notice year; paper year; article type; journal; publisher; notice paywalled; editorial-staff notices.
- Subject groups show Retraction Watch's names with their codes, such as "Basic Life Sciences (BLS)". The names come from its user guide's "Appendix A: Fields", checked 2026-10-13.
- The results column: the total by notice type, the query summary as removable chips, a toolbar (sort, Cite this search, Download CSV), the results and pagination.
- Below 820 px wide, the sidebar folds behind a Filters button and the header stacks.
- The header reads "Data as of October 9, 2026", with the month spelled out. Result lines use AP abbreviations to save space.
- The footer separates "Missing retraction? Tell Retraction Watch" from "Problem with this site? Open an issue on GitHub". The issue opens with the page's link and the data date filled in, through GitHub's `title` and `body` URL parameters. The no-results state repeats the GitHub link. The link only works for others once the repository is public.

**Filters**

- Each value is a row: a checkbox to include it, its count, and a small minus icon to exclude it (faint until hover on devices with a mouse).
- List filters with two or more included values show an "any / all" switch.
- Subject categories open with an arrow to show their subjects. Long filters have a search box and "Show all".
- Each filter carries its data caveat as a short note.
- Year filters show a bar per year, which can be clicked to select that year, plus "from" and "to" inputs.

**Results**

- A notice-type label in words. Dates read "Notice issued Sept. 24, 2026 · Paper published Oct. 2, 2021", in AP style.
- The title (matched words highlighted), then the journal and publisher. Selecting either filters to it.
- Author names: the first ten, plus any further down that matched the search, then "Show all N names". A "Name match" tag appears when the search matched a name.
- Selecting an author name, in a result or on a record page, adds that exact name to the search. The summary reads "listing the author name '…'", and a yellow warning (no icon) says these are name matches only: different people can share a name, and the same person may appear under other spellings or with initials.
- Selecting the title or "Record page" opens the record page.
- Retraction Watch's reasons, colored by group. Countries.
- Retraction Watch's links, each with its date and how many records link to it.
- Links to the notice and the paper. "All fields" expands the rest in place.

**Search in a field** opens rows, each with a field (title, author name, institution, journal or publisher), "contains / doesn't contain" and some words. "Add a row" adds another. Helper text says that a row matches when all its words appear somewhere in that field, and explains how rows combine with each other and with the filters. Opening it doesn't move the header.

**Visual values**

- Typefaces: Public Sans for text, IBM Plex Mono for identifiers.
- Colors: grays from #16191D to #F7F8FA, one accent (#1F5AA6), and the excluded state in rust (#A84D17).
- Notice types: Retraction dark, Expression of concern amber, Correction gray-blue, Reinstatement green. Each always appears with its name.
- Reason colors: eight topic groups, plus "Other" for two reasons. Pastel backgrounds with dark text of the same hue; nothing is red. The grouping is this site's, not Retraction Watch's, and the Reason filter's note says so.

| Group | Matches reasons containing (in this order) |
|---|---|
| Investigations | starts with "Investigation by" |
| Notice and status | "Notice -", "Date of Article", "Removed", "Temporary Removal", "Update", "Retract and Replace", "EOC Lifted", "No Further Action", "Doing the Right Thing", "Nonpayment" |
| Data and results | starts with "Original Data" |
| Images | "Image" |
| Plagiarism, duplication and text | "Plagiarism", "Duplication of/in Article", "Duplication of Text", "Euphemisms for Duplication", "Taken from", "Taken via", "Salami", "Referencing", "Cites Retracted", "Error in Text", "Copyright" |
| Peer review and publishing | "Peer Review", "Paper Mill", "Rogue Editor", "Computer-Aided", "Third Party Involvement", "Hoax", "by Journal/Publisher", "Conference", starts with "Withdrawn" |
| Data and results | "Data", "Results", "Analyses", "Methods", "Materials", "Cell Lines", "Reproducible", "Contamination", "Sabotage" |
| Ethics, conduct and legal | "IRB", "Consent", "Welfare", "Ethical", "Conflict of Interest", "Misconduct", "Bias", "Legal", "Civil", "Criminal", "Publishing Ban", "Euphemisms" |
| Authorship and approval | "Author", "Affiliation", "Approval", "Objections", "Complaints", "Miscommunication" |

On the 2026-10-09 snapshot, this puts each of the 112 reasons in a group, and two in "Other". Because filter values come from the data, a new reason that matches no rule lands in "Other", and the check report lists it.

## How it fits together

```
browser ──► Next.js server code (web/) ──► Typesense 30.2 (Docker)
                    │
                    └──► Redis (Docker): per-visitor rate-limit counters

pipeline: npm run clean ──► search-documents.jsonl ──► npm run load ──► Typesense (admin key)
```

New and changed files:

- `docker-compose.yml`: Typesense (`typesense/typesense:30.2`) with its data in `data/typesense/`, and Redis (`redis:8.10.2-alpine`, the newest release on Docker Hub, checked 2026-10-13). Both listen only on 127.0.0.1. `npm run search:down` stops them.
- `pipeline/src/load.js`: loads the newest cleaned snapshot into Typesense (below).
- `pipeline/sql/20_search_documents.sql`: adds `url_record_counts` (below).
- `web/`: the Next.js 16 app, in TypeScript with Tailwind CSS 4.
- `.env.local` (not committed): the Typesense admin key (used only by `load`), the search-only key, the Redis URL and the salt for hashing visitors.

## Data in Typesense

**Loading.** `npm run load`:

1. Creates a collection named after the snapshot and the load time, such as `retractions_2026-10-09_bc5648dd_20261013T222801Z`, with the schema below. Loading the same snapshot again gives a fresh collection.
2. Imports the search documents in batches. Typesense's import returns HTTP 200 even when documents fail, so the script reads every result line and stops on the first failure.
3. Checks that the document count equals the snapshot's row count.
4. Points the alias `retractions` at the new collection, then deletes collections older than the previous one.
5. Writes the snapshot's data date and commit to a one-document `meta` collection, which pages read for the data date.
6. Creates or reuses a search-only key limited to `documents:search` on the alias, the snapshot collections and `meta`. A new key is saved to `.env.local` as `TYPESENSE_SEARCH_KEY`, and older keys of the same kind are deleted.

Spec 003 reuses this script for the daily run.

**Schema.** Fields outside the schema are stored and returned but not indexed (decision record 002).

| Field | Type | Indexed for |
|---|---|---|
| `title` | string | search |
| `authors`, `institutions` | string[] | search |
| `journal`, `publisher` | string | search and filters |
| `notice_type`, `paywalled` | string | filters |
| `reasons`, `subjects`, `subject_categories`, `countries`, `article_types` | string[] | filters |
| `is_revision`, `has_editorial_staff_author` | bool | filters |
| `notice_year`, `paper_year` | int32 | filters and per-year counts |
| `notice_date`, `paper_date` | int64 (Unix seconds, negative before 1970) | sorting |
| `notice_doi`, `paper_doi` | string | exact lookup |
| `notice_pubmed_id`, `paper_pubmed_id` | int64 | exact lookup |
| `record_id` | int32 | record pages |
| `urls`, `url_record_counts`, `notes`, `original` | not indexed | shown on results and record pages |

**Pipeline addition.** `url_record_counts` gives, for each of a record's URLs, how many records list the same URL, ignoring http versus https and a trailing slash (AC18a). Computing this in SQL keeps it a single pass over the snapshot instead of an extra query per page.

## The query

One `Query` type holds everything the URL can say: search text, field terms with their any or all choice, each filter's included and excluded values with its any or all choice, the year ranges, the revision and editorial-staff options, the sort order and the page.

Pure functions in `web/lib/query/`, all unit-tested:

- `parseQuery(searchParams)` and `serializeQuery(query)`. Serializing gives one canonical form, and parsing it back returns the same query. The default view serializes to no parameters (AC16).
- `describeQuery(query)` gives the summary's parts, each with what removing it does, and the plain-language sentence (AC15). The citation (AC24) builds on it.
- `toTypesense(query)` gives the body of one `multi_search` request.

URL parameters follow the prototype:

- `q`
- `in_title`, `not_in_author` and so on, with `in_<field>_match=all`
- `author_name`, repeated for each selected name
- `type` (absent means retractions only; `type=all` means every type)
- `reason`, `not_reason`, `reason_match=all`, and the same for each filter
- `notice_from`, `notice_to`, `paper_from`, `paper_to`
- `revisions=include`, `editorial_staff=exclude`
- `sort`, `page`

**One request for results and every count.** Typesense's `multi_search` sends up to 50 searches in one HTTP request. The body holds:

- the main search: every clause, the page of results and the counts for filters that have no selection or are set to "all"
- one more search per "any" filter that has a selection: every clause except that filter's own, no results, counts for that field only (AC4)
- the same for the two year filters and the two options, so their counts ignore their own setting

That's at most about a dozen searches.

**Mapping to Typesense filters.** Values are written as backtick literals, so commas and parentheses inside values are safe.

| Query part | `filter_by` |
|---|---|
| Any of several values | ``reasons:=[`A`, `B`]`` |
| All of several values | ``reasons:=`A` && reasons:=`B` `` |
| Excluded values | ``reasons:!=[`C`]`` |
| Year range | `notice_year:>=2015 && notice_year:<=2020` |
| Options | `is_revision:=false`, `has_editorial_staff_author:=false` |
| Field term (all its words, anywhere in the field) | `institutions:University of Toronto` |
| Excluded field term | ``(institutions:! university || institutions:! of || institutions:! toronto)``, which keeps records missing any of the words |
| Selected author names (each must be listed exactly) | ``authors:=`Maria Example` && authors:=`Jun Sample` `` (spike S8) |
| Identifier lookup | ``notice_doi:=`x` || paper_doi:=`x` ``, ignoring every other clause |

**Search text** uses `q` over `title,authors,institutions,journal,publisher`, with typo tolerance set per field (`num_typos`). Institutions and authors get fewer allowed typos, settled by spike S6.

**Sorting:** relevance is `_text_match:desc,notice_date:desc`; the date orders sort on `notice_date` or `paper_date`.

**Filter counts:** small filters (notice type, reason, subject, country, article type, paywalled) return every value in one go. Publisher and journal return their top values, and their search box asks `/api/facet-values`, which uses Typesense's `facet_query`.

**Highlighting** uses Typesense's highlight output for title and authors, with marker strings that the page splits into text and `<mark>` elements. No returned HTML is inserted directly.

## Pages and server code

| Path | What it does |
|---|---|
| `app/page.tsx` | Server component. Parses the URL, checks the rate limit, runs the `multi_search`, renders everything. |
| `app/record/[id]/page.tsx` | Fetches one record with a search filtered by `record_id`, because a search-only key can't fetch documents directly. Shows every field, with the original values next to the cleaned ones. The URL is always just `/record/<id>`, so links to a record never carry a search. The header has the site name and data date but no search box. |
| `app/about/page.tsx` | The data source, license, caveats, how counts work, and how to report a missing retraction (AC26). |
| `app/api/facet-values/route.ts` | Value search for long filters. |
| `app/api/export/route.ts` | The CSV download (below). |

**Client components:**
- the search box and field-search rows (they update the URL after a 300 ms pause)
- year inputs
- the value search in long filters
- the phone filter drawer (Radix Dialog)
- tooltips (Radix Tooltip)
- the copy-citation button
- "Copy link to this record" on record pages
- "Back to results" on record pages, shown only when the previous page was a search on this site (a same-site referrer on the search page). It calls the browser's back, so the results and scroll position come back as they were.

**Filter links** are `<Link prefetch={false} scroll={false}>`. A clicked value shows as selected straight away, and the old results dim until the new ones arrive. Next.js 16's API for showing link status gets checked at setup.

**Server-only code** lives in `web/lib/server/`, which imports `server-only` so it can't end up in browser code. The search key is read there from the environment and never passed to a component (AC27).

## Rate limits and failures

**Rate limits (AC28).**
- **Mechanism:** a fixed-window counter in Redis per visitor. A visitor is a salted hash of the first address in `x-forwarded-for`; no cookies.
- **Limits:** 60 searches a minute and 6 downloads an hour per visitor (agreed 2026-10-13).
- **When a page is over the limit,** it renders the notice with the time to try again, and keeps the query.
- **When a route handler is over the limit,** it returns HTTP 429 with `Retry-After`.
- **Production store:** Redis on Railway, under the same $50 hard limit. Its public access goes through a TCP proxy that's billed as data transfer. Phase 4 confirms the cost.

**Failures (AC29).** If Typesense or Redis can't be reached, the page shows "Search is unavailable right now", with the attribution and the query kept, instead of an error page. If Redis alone is down, searches go ahead without rate limiting and the failure is logged, so a counter outage doesn't take search down with it.

## CSV download

`/api/export` takes the same URL parameters as the search page.

- **Filters only:** it streams Typesense's export endpoint, which takes `filter_by` and `include_fields` and returns JSON lines in chunks.
- **With search text or field terms:** the export endpoint has no search-text parameter, so the handler pages through search results 250 at a time (the per-page maximum) and streams each page as it arrives. Spike S4 times this for the largest case.
- **Format:**
  - UTF-8 with a byte-order mark, so spreadsheet apps keep non-English characters.
  - A header row, and one column per field shown on record pages.
  - List fields joined with "; ". No entry can contain a semicolon, because the cleaning split on semicolons, so splitting on ";" and trimming gives the entries back exactly (AC23).
  - The file name includes the data date, such as `retraction-search-2026-10-09.csv`.

## Tests

| What | How | Covers |
|---|---|---|
| Query parsing, serializing, summary, citation, Typesense mapping, reason groups, date format | Vitest unit tests in `web/`, no network | AC2, AC4, AC5, AC11, AC12, AC15, AC16, AC17, AC19, AC24 |
| Counts against DuckDB | `npm run check:search`: a fixed set of queries run against the local stack and against DuckDB on the same snapshot, comparing totals and every filter count | AC4, AC6, AC8, AC30 |
| Search behavior on real data | The same script: deep paging to the last page, years before 1970, the Toronto/Torino pair in both directions, identifier lookups, export round trip | AC8, AC12, AC13, AC20, AC23 |
| Pages | Playwright on the local stack, with axe on the start, results, no-results and record pages, plus keyboard-only runs | AC1–3, AC7, AC9, AC10, AC14, AC18, AC18a, AC18b, AC21, AC22, AC25, AC26, AC31, AC32 |
| Failures | Playwright with Typesense stopped and with the rate limit set low | AC28, AC29 |
| No key in the browser | A test that builds the app, then searches the built browser files, page HTML and responses for the key | AC27 |
| Speed | A script timing the server response for the fixed query set (p95), and Lighthouse's mobile test on a shared URL | AC33 |
| Commands | Run from a fresh clone | AC34 |
| Screen reader | A written manual VoiceOver check covering one full search | AC32 |

`npm test` stays network-free. The checks that need Docker and the full snapshot run through their own commands.

## Spikes first

Each is a short experiment against the local stack before the matching tasks start. If one fails, the spec gets a proposed change before code continues.

- **S1, field terms (AC11). Run 2026-10-13 on Typesense 30.2; a filter can't hold a phrase to one entry.** Decided: match word by word for now (see "Field terms" below).
- **S2, exact counts (AC4, AC30).** Check that the extra searches give exact counts that match DuckDB, including for "all" filters and excluded values.
- **S3, deep paging (AC20).** Check `limit_hits` and that the last page of 67,384 retractions loads.
- **S4, export.** Check that the export endpoint accepts every filter form, and time the paged export for the largest text search.
- **S5, keys.** Check that a key limited to the snapshot collections can search through the `retractions` alias.
- **S6, typos (AC13).** Find per-field `num_typos` settings that keep Toronto and Torino apart without losing ordinary typo matches.
- **S7, dates before 1970 (AC8).** Check that negative timestamps sort correctly.
- **S8, exact author names (AC14).** Check that ``authors:=`Maria Example` `` matches the exact list entry, and whether it's case-sensitive.

## Field terms: what spike S1 found

Tested on 2026-10-13 against Typesense 30.2 in Docker, with five synthetic records:

- **The word-level filter** `institutions:University of Toronto`, with or without backticks, matches when every word appears anywhere in the field. Word order doesn't matter, and the words can come from different entries.
- **A quoted phrase in the search text,** searching only `institutions`, matches the phrase within one entry, which is what AC11 asks for. But a search has a single search text, so it can't serve the search box and a field term at once.
- **Word exclusion** (`title:! cancer`) works. Negating a group with `!( … )` doesn't parse, so exclusions are written as `||` chains of `:!=`.
- **Same-entry filters** (`field.{…}`) work on plain values, but hung with no response in 20 seconds when each entry held a list. Avoid that shape.

Measured on the 2026-10-09 snapshot (retractions without revised versions):

| Phrase in institutions | True phrase in one entry | All words anywhere in the field | Word pairs within one entry |
|---|---|---|---|
| University of Toronto | 131 | 167 | 131 |
| University of California | 448 | 628 | 448 |
| Chinese Academy of Sciences | 534 | 906 | 534 |
| Department of Medicine | 832 | 8,744 | 4,082 |

Word pairs fail on generic phrases because one affiliation string often names several units ("Department of Surgery, Faculty of Medicine"). Three ways forward:

1. **Word pairs and triples, stored by the pipeline and matched with exact filters.** A phrase of up to three words matches its own pair or triple, which is contiguous by construction. Longer phrases chain overlapping triples, which could rarely over-match. One request, and counts stay exact. The cost is index memory: about 5.1 million entries and 88 MB of text for institutions and titles. By decision record 002's rule of thumb that's roughly 175–265 MB more memory, or $2–3 a month on Railway (an estimate to measure).
2. **Two steps.** A phrase search on the field collects the matching record IDs, and the main search filters to them. This uses Typesense's own phrase matching and needs no extra memory, but costs an extra round trip. IDs arrive 250 per page, up to 50 pages per request, so very broad phrases need a fallback.
3. **Relax AC11:** a multi-word term matches when all its words appear in the field. The simplest option, but it over-counts generic phrases ten times over.

**Decided 2026-10-13: option 3 for now.** The field-search helper text says a row matches when all its words appear somewhere in the field. Options 1 and 2 stay here in case over-counting becomes a problem. Option 1 would start by loading the full snapshot with pairs and triples to measure the memory.

## Spec changes agreed

- **AC12** (2026-10-13): an identifier lookup ignores the filters and says so. Otherwise the DOI of an expression of concern finds nothing under the retractions-only default.

## Commands (AC34)

| Command | What it does |
|---|---|
| `npm run search:up` | Starts Typesense and Redis in Docker |
| `npm run load` | Loads the newest cleaned snapshot into Typesense |
| `npm run web` | Starts the site at http://localhost:3000 |
| `npm run check:search` | Runs the checks that need the local stack and full data |

Docker Desktop or a similar Docker setup is needed (decision record 002).

## Still open

- From the spec: the speed budgets, and how to label Retraction Watch links that aren't blog posts.
