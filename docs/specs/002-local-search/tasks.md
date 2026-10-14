# Tasks 002: Local search MVP

Status: in progress, 2026-10-13. Follows [plan 002](plan.md). Spike S1 ran during planning; its result is in the plan. Work one task at a time, and tick a task off once its "done when" check passes. If a spike or task shows the spec can't be met as written, stop and propose a spec change first.

**Local stack and data**

- [x] **1. Local stack.** `docker-compose.yml` runs `typesense/typesense:30.2` with its data in `data/typesense/`, and Redis at a pinned version (`redis:8.10.2-alpine`). `.env.example` lists the variables, and `.env.local` stays out of git. A root `search:up` script starts both. (AC34)
  - Done when: `npm run search:up` starts both containers, and Typesense's `/health` returns ok.

- [x] **2. Link counts in the search documents.** `pipeline/sql/20_search_documents.sql` adds `url_record_counts`: for each of a record's URLs, how many records list the same URL, ignoring http versus https and a trailing slash. (AC18a)
  - Done when: a fixture test shows the counts line up with `urls`, and two records sharing a post both count 2.

- [x] **3. Load command.** `pipeline/src/load.js` and `npm run load`:
  - creates a collection named after the snapshot, with the plan's schema, and imports the documents in batches
  - stops on the first failed import line, and checks the document count
  - switches the `retractions` alias, keeps only the previous collection, and writes the `meta` document
  - creates or reuses a search-only key

  (AC25, AC34)
  - Done when: unit tests cover the schema and the reading of import results, and `npm run load` loads the 2026-10-09 snapshot with 73,100 documents. A second run switches the alias to a fresh collection.

- [x] **4. Spikes S2–S8.** Run each spike from the plan against the loaded snapshot, and write the result into the plan's spike list:
  - S2, exact counts
  - S3, deep paging
  - S4, export
  - S5, a search-only key through the alias
  - S6, typo settings
  - S7, dates before 1970
  - S8, exact author names

  (AC4, AC8, AC13, AC14, AC20, AC23, AC27, AC30)
  - Done when: every spike has a recorded result, and any that fail have a spec change proposed and agreed.

- [x] **4a. Clean names for exact filters.** `pipeline/sql/10_records.sql` merges journal and publisher spellings that differ only in capitals or accents into the most common one, and fixes backticks in author names. `original` keeps the published text. The hashed name keys from the first version of this task are removed, and the load's value check covers journals and publishers too. (AC4, AC14, AC22, AC30)
  - Done when: fixture tests cover the merged spellings, the backtick rule and the original values. After a load, filtering on each of the 6 merged journals and on "Springer" gives its DuckDB count, and each of the 6 author names that had a backtick finds its records.

- [x] **4b. Load: full names, value check and the site's key.** `npm run load`:
  - stores in `meta` the full name of each journal and publisher value that Typesense cut short, and stops if two names share a cut value
  - stops if two values of a string filter field differ only in capitals or accents
  - creates the site's key with `documents:search` and `documents:export` on `retractions` and `meta`, and deletes older keys from the load

  (AC6, AC23, AC27, AC30; plan changes P1, P2, P5)
  - Done when: unit tests cover the cut-name map and the value check, and the 2026-10-09 snapshot loads with 135 full names in `meta`. The new key can export through the alias but can't list collections.

**Query logic (unit-tested, no network)**

- [x] **5. Web workspace.** `web/` with Next.js 16, TypeScript, Tailwind CSS 4 and Vitest, added to the npm workspaces. The theme holds the design values from the plan: typefaces, grays, accent, notice-type colors and reason-group colors. A root `web` script starts the site. (AC34)
  - Done when: `npm run web` serves a placeholder page, and `npm test` runs the web and pipeline tests together.

- [x] **6. Parse and serialize the query.** `web/lib/query/`: the `Query` type, `parseQuery` and `serializeQuery`, with the plan's URL parameters. (AC2, AC16)
  - Done when: tests show every part of a query survives a round trip, unknown parameters are ignored, and the default query serializes to no parameters.

- [x] **7. Summary, totals and citation text.** `describeQuery` returns the summary's parts, each with the query that removing it gives, and the sentence. Also the total by notice type and the citation line. (AC15, AC17, AC24)
  - Done when: tests cover the spec's example sentence, every filter and option, field terms ("the words …"), author names ("listing the author name …"), identifier lookups, mixed notice-type totals, and both ISSNs in the citation.

- [x] **8. Typesense mapping.** `toTypesense(query)` builds the `multi_search` body: the main search, one counts search per "any" filter with a selection, and searches for the year and option counts. It also covers field terms and exclusions, exact author names, identifier lookups that ignore the filters, sort orders with the `record_id` tie-breaker, and paging. Searches with text set `num_typos` 2,1,1,2,1 and `drop_tokens_threshold` 0, and add the exact-match count. A second form of the body turns typos on for every search. (AC4, AC5, AC8, AC10, AC11, AC12, AC13, AC14, AC19, AC20)
  - Done when: tests check the body for each case in the plan's mapping table, including values with commas and parentheses.

- [x] **9. Reason groups and dates.** One module maps reasons to their color groups by the plan's rules. One formats dates in AP style, plus the "as published" form. (AC9, AC18)
  - Done when: tests put each of the 112 reasons in the 2026-10-09 snapshot in its expected group, two in "Other", and format "Sept. 24, 2026" and "Aug. 1, 2013".

**Pages and server code**

- [x] **10. Server search and failure state.** `web/lib/server/` (importing `server-only`): the Typesense client using the search key from the environment, `runSearch`, and parsing results, counts and highlights into the page's data. It swaps cut journal and publisher values for their full names from `meta`. When the exact-match count is 0 but close spellings matched, it reruns the request with typos on for every search and marks the result as close spellings. An unreachable Typesense gives a "search unavailable" result instead of an error. (AC6, AC13, AC27, AC29)
  - Done when: tests with recorded Typesense responses parse correctly, highlights become text and marks without HTML, a close-spellings response triggers the second request, and an unreachable server returns the unavailable result.

- [ ] **11. Search page: results.** `app/page.tsx` renders the header (search box above the results), the total by notice type, the summary chips, the toolbar, the results, pagination and sort, plus the no-results state with its "remove one part" options and the close-spellings notice. (AC1, AC2, AC13, AC15, AC16, AC17, AC19, AC20, AC21)
  - Done when: against the local stack, the default page shows 67,384 retractions, a shared URL opens with its results in the first load, and paging reaches the last page.

- [ ] **12. Search page: filters.** The sidebar in the plan's order, built as links that keep the scroll position and don't prefetch:
  - value rows that include or exclude, and the any/all switch
  - subject groups that open to show their subjects
  - year bars and inputs, and the two options
  - each filter's caveat
  - the phone drawer (Radix Dialog)
  - a selected value showing straight away while results load

  (AC3, AC4, AC5, AC6, AC7, AC8, AC9, AC31)
  - Done when: every filter works against the local stack, counts follow the plan's rules, and the drawer works at 375 px.

- [ ] **13. Value search for long filters.** `app/api/facet-values/route.ts` uses Typesense's `facet_query` for the publisher and journal filters, with cut values swapped for their full names, and the filter's search box calls it. (AC6)
  - Done when: typing part of any of the 1,717 publishers or 8,771 journals finds it.

- [ ] **14. Search box and field search.** Client components update the URL after a 300 ms pause. Field-search rows have the helper text and "Add a row". DOI and PubMed ID lookups say that filters don't apply. (AC10, AC11, AC12)
  - Done when: a misspelled title word still finds the record, a two-row field search matches the plan, and pasting the DOI of an expression of concern finds it under the default filters. A search whose filters leave no exact match shows the close-spellings notice, with counts that agree with the results.

- [ ] **15. Result details.** In each result:
  - the first ten author names, plus any further down that matched, and "Show all N names"
  - names that link to an exact name search, with the yellow name-match warning
  - Retraction Watch links with their dates and counts
  - journal and publisher links that filter
  - "All fields" expanding in place

  (AC14, AC18, AC18a, AC18b)
  - Done when: searching for the surname of record 7962's 11th author shows that name after "…" with "Show all 14 names". The name link gives the same count as a DuckDB query for that name ignoring capitals and accents, with the warning. A batch post shows "Linked from 10,855 records".

- [ ] **16. Record page.** `app/record/[id]/page.tsx`:
  - every field, the "as published" values, Retraction Watch coverage, and author name links
  - "Copy link to this record", and no search box
  - "Back to results" only when the visitor came from a search on this site

  (AC14, AC18a, AC22)
  - Done when: `/record/7962` shows all 14 authors and 9 institutions, and opening it directly shows no back link.

- [ ] **17. Cite this search.** The citation panel and its copy button. (AC24)
  - Done when: the citation for the brief's example matches the one from task 7 and copies to the clipboard.

- [ ] **18. CSV download.** `app/api/export/route.ts`:
  - streams Typesense's export endpoint with the site's key when there's no search text, and pages 250 at a time otherwise
  - writes UTF-8 with a byte-order mark, one column per record-page field, and list fields joined with "; "
  - names the file with the data date

  (AC23)
  - Done when: the downloaded file has the same records and count as the page for a filter-only query and a text query. List fields also split back exactly.

- [ ] **19. Rate limits.** A fixed-window counter in Redis per salted visitor hash: 60 searches a minute and 6 downloads an hour. Pages show the limit notice and keep the query; route handlers return 429 with `Retry-After`. If Redis is down, searches continue and the failure is logged. (AC28, AC29)
  - Done when: tests with a low limit show the notice and the 429, and stopping Redis doesn't stop search.

- [ ] **20. Attribution, issue link and About page.** On every page:
  - the footer: the data date from `meta`, credit to Retraction Watch, the source link, and the statement that the site isn't affiliated
  - "Missing retraction? Tell Retraction Watch"
  - "Problem with this site? Open an issue on GitHub", filled in with the page's link and the data date

  Plus `app/about/page.tsx`. (AC25, AC26)
  - Done when: every page shows the footer, and the About page covers each data caveat in the brief.

**Checks**

- [ ] **21. Search check against DuckDB.** `npm run check:search` runs a fixed set of queries against the local stack and DuckDB on the same snapshot. It compares totals and every filter count, and covers:
  - deep paging, and years before 1970
  - the twelve name pairs from spike S6 in both directions, the close-spellings fallback, and identifier lookups
  - author names, including ones that differ only in capitals or accents, merged journal spellings, and the export round trip

  (AC4, AC6, AC8, AC12, AC13, AC14, AC20, AC23, AC30)
  - Done when: the command passes on the 2026-10-09 snapshot.

- [ ] **22. Browser tests.** Playwright on the local stack:
  - the main flows, plus axe on the start, results, no-results and record pages
  - keyboard-only runs, and 375 px width
  - Typesense stopped, a low rate limit, and a test that no key appears in built files, page HTML or responses

  (AC1, AC2, AC3, AC7, AC9, AC10, AC14, AC18, AC18a, AC18b, AC21, AC22, AC25, AC26, AC27, AC28, AC29, AC31, AC32)
  - Done when: the suite passes, and axe reports no WCAG 2.2 AA violations.

- [ ] **23. Screen reader check.** Write the manual VoiceOver check covering one full search, run it and record the result. (AC32)
  - Done when: the check is written down and passes.

- [ ] **24. Speed.** A script times the server response for the fixed query set (p95), and Lighthouse's mobile test runs on a shared URL. Confirm the budgets with the owner. (AC33)
  - Done when: both meet the agreed budgets, or the plan records why not and what changes.

- [ ] **25. End-to-end on a fresh clone.** In a fresh clone, run:
  - `npm install`
  - `npm run download`, then `npm run clean`
  - `npm run search:up`, then `npm run load`
  - `npm run web` and `npm run check:search`

  Add the new commands to `CLAUDE.md`. (AC34)
  - Done when: every command succeeds in the fresh clone and `CLAUDE.md` lists them. That completes the spec, and spec 002 goes up as a pull request.
