# Spec 002: Local search MVP

Status: draft, 2026-10-13. Phase 2 of the [roadmap](../../product-brief.md#roadmap). The design was chosen from prototypes and is recorded in [plan.md](plan.md).

## Problem

Spec 001 turns the CSV into clean search documents, but they can't be searched yet. Researchers and journalists still have two options. The official search has no reason, subject or notice-type filter and shows at most 50 entries. The raw CSV needs cleaning first. Phase 2 builds the site that the brief describes. It runs on a laptop against a local search server, so its behavior can be tested and shown to users before anything is hosted.

## Users

The two groups in the [product brief](../../product-brief.md#users), doing the MVP jobs:

- Researchers find retractions that match a pattern and pull that slice for analysis.
- Journalists find and count retractions for a story and cite numbers that editors and readers can check.

## Hypothesis

We believe a researcher or journalist can answer a real question in a few minutes without the CSV, for example the brief's "image-manipulation retractions in neuroscience, by country, since 2015". We'll know from the validation sessions in the brief: each participant answers a question of their own without help and can send a link that reproduces the answer.

## Decisions

From the product brief (2026-10-12):

- Only retractions are selected by default. The other notice types and their counts are one click away.
- Revised versions are hidden by default, with an option to include them.

Made 2026-10-13:

- The current results can be downloaded as a CSV file with no row cap. Downloads have their own, stricter per-visitor limit.
- Within a filter, each value can be included or excluded. Included values match any of them, and list fields can switch to matching all of them.
- There are two year filters, one for the notice and one for the original paper.
- The results page offers a ready-made citation.
- Each visitor can make 60 searches a minute and 6 downloads an hour.
- Looking up a DOI or PubMed ID ignores the filters, so the record is found whatever its notice type.
- Problems with the site are reported as GitHub issues, separately from problems with the data, which go to Retraction Watch.
- Field terms match word by word for now: a multi-word term matches when all its words appear in the field. This over-counts generic phrases, such as "Department of Medicine" in institutions. The plan's "Field terms" section has the measurements and the options for matching phrases later.
- Results show at least the first ten author names, plus any further down that matched the search.
- Selecting an author name shows the records that list that name, ignoring capitals and accents, as a labeled name match (AC14).
- Journal and publisher spellings that differ only in capitals or accents, such as "medRxiv" and "medrxiv", become the most common spelling. Each journal then has one filter value and one count. Record pages show the spelling Retraction Watch published (AC22).
- Backticks in author names are treated as bad data. A backtick between two letters becomes an apostrophe, and any other backtick is removed. Record pages show the published name (AC22).
- When the filters leave no exact match for the search text, the page shows close spellings and says so (AC13, after spike S6).
- Subject groups use Retraction Watch's own names, shown with their codes, from its user guide's "Appendix A: Fields" (checked 2026-10-13): Basic Life Sciences (BLS), Business and Technology (B/T), Environmental Sciences (ENV), Health Sciences (HSC), Humanities (HUM), Physical Sciences (PHY) and Social Sciences (SOC).

## Acceptance criteria

Every criterion is checked locally against one pinned snapshot. "List fields" are the filters where one record can hold several values: reason, subject, country and article type.

**Starting point**

- AC1: With no search text and no filter, the page lists records and shows every filter's counts. No search criterion is needed.
- AC2: By default, results are retractions only, without revised versions. The query summary (AC15) states both defaults. The counts for the other notice types and for revised versions are visible, and each is one click away.

**Filters**

- AC3: There are filters for notice type, reason, subject, country, publisher, journal, article type, notice year, paper year, whether the notice is paywalled, revised versions, and notices that list the journal's editorial staff as the author.
- AC4: Every filter value shows a count, and the counts update after every change. In a filter that matches any of its values, a value's count is the number of records that match every other filter and have that value. In a filter that matches all of its values, a value's count is the number of records that match every filter, including that one, and also have that value.
- AC5: Each value can be included or excluded. Included values match any of them by default, and list fields can switch to all of them. A record has to match every filter.
- AC6: Every value of every filter can be reached, including all 1,718 publishers and 8,778 journals. Long filters show the most common values first and can be searched by name. A selected value stays visible even when its count drops to zero.
- AC7: Subjects have two levels: the seven categories, and the subjects within each. A whole category can be selected at once. Categories are shown by name, not only by code.
- AC8: Each year filter selects a range, which can be open at either end, and shows how many matching records fall in each year. Years before 1970 filter and sort correctly.
- AC9: Filters state the data caveats that affect their counts:
  - Reasons are labeled as Retraction Watch's classification.
  - The country filter says that a record lists the country of every author, so country counts overlap and add up to more than the number of results.
  - The notice-type filter says that expressions of concern and corrections are covered selectively.
  - The paywalled filter says it describes the notice, not the paper.
  - The year filters say that dates are approximate below the year.

  "Unknown" appears as its own value wherever Retraction Watch recorded it. Each caveat links to its explanation on the About page (AC26).

**Text and field search**

- AC10: One search box searches titles, author names, institutions, journals and publishers together, and tolerates typos.
- AC11: Without typing operators, users can add several terms at once, each for a single field (title, author name, institution, journal or publisher), choose whether one field's terms match any or all of them, and exclude terms. Helper text explains how these terms combine with each other and with the filters. A term of several words matches records where all its words appear somewhere in that field, in any order.
- AC12: Pasting a DOI (in any case, with or without a doi.org prefix) or a PubMed ID finds the records whose notice or paper has it, and says which of the two matched. The lookup ignores the filters and says so.
- AC13: Typo tolerance doesn't mix up near-identical names while the search has exact matches. A fixed list of name pairs, starting with Toronto and Torino, is tested in both directions. When the filters leave no exact match and the page falls back to close spellings, it says so. The words that matched are highlighted in each result, so a match on a different spelling is visible.
- AC14: Author matches are labeled as name matches. Selecting an author name in a result or on a record page shows the records that list that name, ignoring differences in capitals and accents. The results say they are name matches only: different people can share a name, and the same person may appear under other spellings or with initials. The summary describes the records as "listing the author name", never as one person's work. There's no list of authors to filter by, and the site shows no per-author counts, rankings or profiles.

**Query summary and links**

- AC15: A plain-language summary describes the whole query, including the defaults. For example: "Retractions, excluding revised versions, where Retraction Watch's reasons include Manipulation of Images or Duplication of/in Image, in the subject Neuroscience (BLS), with notices from 2015 on." Each part can be removed from the summary.
- AC16: The URL holds the whole query: search text, field terms, filters with their include, exclude, any and all choices, years, sort order and page. Opening it in a new browser shows the same results and counts on the same data, and the results arrive with the first page load, not after a loading state. Back and forward step through earlier queries. The default view's URL holds no query.

**Results**

- AC17: The total is given by notice type, for example "1,234 retractions", or "1,200 retractions and 34 expressions of concern" when several types are included. A set with several notice types is never counted as retractions.
- AC18: Each result shows its notice type as a label in words, not only as a color. It also shows the title, the notice and paper dates, journal, publisher, reasons, countries and author names, and links to the notice and the paper. Author names include at least the first ten and any that matched the search, with the rest one click away. Every other field of the record can be seen from the results without a new search.
- AC18a: When Retraction Watch lists URLs for a record, its result links to them. A link to a Retraction Watch blog post shows the post's date and how many records link to the same post, so a post about a batch of retractions isn't read as a story about one paper.
- AC18b: Selecting a result's journal or publisher filters the search to it, and that filter can be removed like any other.
- AC19: Results can be sorted by relevance (when there's text to match), by notice date or by paper date, newest or oldest first. The default is relevance when there's text, and newest notice first when there isn't.
- AC20: There's no result cap. Every matching record can be reached by paging, and the page number is part of the URL.
- AC21: When nothing matches, the page says so, repeats the query summary and offers to remove each part of the query.

**Record pages**

- AC22: Each record has its own page, with a URL based on its Record ID that anyone can link to, showing every field. The page has no search box. A visitor who came from a search on this site gets a link back to those results, at the same place in the list; a visitor arriving from a shared link doesn't see it. A button copies the page's link. Where cleaning changed a value, the value Retraction Watch published is shown next to it. The page links to the notice and the paper, and lists every URL Retraction Watch gives for the record, labeled as in AC18a.

**Download and citation**

- AC23: The current results download as a CSV file. It holds every matching record with no row cap, and the same records and count as the page. Its columns hold the cleaned values, and list fields can be split back into their entries without ambiguity. Non-English characters survive opening the file in a spreadsheet app. The file name includes the data date.
- AC24: A copy-citation button gives one line with the count by notice type, the query summary, the data date, the URL, and credit to Retraction Watch with both ISSNs labeled: 2692-4579 for the Retraction Watch Database and 2692-465X for the Retraction Watch blog.

**Every page**

- AC25: Every page shows the data date, credits Retraction Watch, links to the source at https://gitlab.com/crossref/retraction-watch-data and states that the site isn't affiliated with Retraction Watch or Crossref. It also links to the project's GitHub issues for problems with the site, kept separate from Retraction Watch's form for missing retractions. The issue opens with the current page's link and the data date filled in.
- AC26: An About page explains where the data comes from and its CC0 license, each [data caveat](../../product-brief.md#data-caveats) in the brief, how counts are computed (including why country counts overlap), what the defaults hide, and how to report a missing retraction through Retraction Watch's own form.

**Server, limits and failures**

- AC27: Browsers never receive a search key. Every search and download goes through the site's server code, and no page, script or response sent to the browser contains a key.
- AC28: Each visitor's searches are rate-limited, and downloads have a stricter limit of their own. Past a limit, the page says so and when to try again, and keeps the query.
- AC29: If the search server can't be reached, pages say that search is unavailable instead of failing, and still show the attribution.

**Correctness**

- AC30: For a fixed set of test queries, the total and every filter count match a direct DuckDB query on the same snapshot. The set covers the defaults, each filter, excluded values, all-of matching, both year filters (including years before 1970) and the longest filter lists.

**Quality**

- AC31: Every feature works at 375 pixels wide as well as on a desktop screen, without horizontal scrolling.
- AC32: Every control works from the keyboard alone and has a label that screen readers announce, and each filter value is announced with its count. Notice types aren't told apart by color alone. An automated accessibility check finds no WCAG 2.2 AA violations on the start, results, no-results and record pages, and a manual VoiceOver check covers one full search.
- AC33: Proposed budgets: on a laptop running the local search server, the site's server code returns results for a search or filter change in under 300 ms at the 95th percentile, over a fixed set of test queries. A shared URL reaches Largest Contentful Paint in under 2.5 seconds in Lighthouse's mobile test, the "good" threshold on web.dev (checked 2026-10-13).

**Running it**

- AC34: One command starts the local search server, one loads the newest cleaned snapshot into it and one starts the site.

## Done when

All acceptance criteria pass locally, and the chosen design is recorded in `plan.md`.

## Success metrics

- The brief's example question can be answered with filters alone, without typing any text.
- In the validation sessions, each participant answers a question of their own without help, and the link they send reproduces their answer.
- Text searches with no results during validation are written down with the query, to tune typo tolerance.

## Non-goals

- Hosting, a public address and analytics (Phase 4).
- Daily updates (spec 003).
- Natural-language filters (Phase 5).
- Checking a list of papers, abstracts and topic search (Phase 6+ candidates).
- Charts beyond the per-year counts in the year filters.
- Accounts, saved searches or alerts.
- Normalizing institutions, publishers or author names, as in spec 001, apart from two narrow fixes listed under Decisions: journal and publisher spellings that differ only in capitals or accents, and backticks in author names.
- Languages other than English.

## Open questions

- **Design:** where the filters sit, how dense the results are, how field terms are added, and whether results expand in place or open their record page. To be chosen from prototypes.
- **Budgets:** the numbers in AC33 are proposals to confirm.
- **Retraction Watch URLs that aren't posts:** in the 2026-10-09 snapshot (checked 2026-10-13), 40,143 records list at least one retractionwatch.com URL. Most are dated blog posts (3,878 distinct). One post is linked from 10,855 records, and 2,589 posts are linked from a single record. 545 distinct URLs go to other Retraction Watch pages, such as its list of retracted COVID-19 papers, its leaderboard and site searches for a person's name. Decide how to label those so they don't read as this site's own ranking or profile. Post titles aren't in the data; the prototypes derive link text from each post's web address.
