# Product brief: Retraction search

Status: draft, 2026-10-12. "Retraction search" is a working name.

**In one sentence:** Filtering the Retraction Watch database by reason, subject or notice type currently means downloading and cleaning a 65 MB CSV; this site offers those filters in a browser, with live counts and no result cap.

## Problem

The Retraction Watch database is the main public record of retraction notices. The 2026-10-02 snapshot had 72,870 notices: 67,440 retractions, 3,728 expressions of concern, 1,540 corrections and 162 reinstatements. Crossref distributes it under CC0 and regenerates the CSV each working day.

There are two ways to use it today, and neither suits exploratory questions:

- **The official search** (retractiondatabase.org) has no field for retraction reason, subject or notice type (checked 2026-10-12). Retraction Watch's [user guide](https://retractionwatch.com/retraction-watch-database-user-guide/) says a search needs at least one criterion and shows at most 50 entries, plus a total count of matches (guide updated 2024-10-23; checked 2026-10-12). Both the search page and the guide point heavy users to the full dataset instead.
- **The CSV** can answer anything, but only after cleaning: dates are strings, multi-value fields are semicolon-delimited, and names and affiliations are free text.

For example, the official search can't answer "image-manipulation retractions in neuroscience, by country, since 2015" at all.

## Users

Both groups are in scope, and the MVP does the same jobs for each.

| Group | Main jobs |
|---|---|
| Researchers, including research-integrity sleuths and meta-researchers | Find retractions that match a pattern (reason, field, publisher, institution). Pull a slice of the data for analysis. Later: check whether cited work has been retracted. |
| Journalists | Find and count retractions for a story (an institution, country, publisher or type of misconduct). Cite numbers that editors and readers can check. |

Post-MVP features lean toward one group or the other. Their order is decided after launch (see Roadmap).

## Hypothesis

We believe researchers and journalists will use a faceted search of the full database instead of the official search or the raw CSV, because the official search can't filter by reason, subject or notice type and the CSV needs cleaning first. We'll know when result clicks (below) reach a target set after launch, and when a meaningful share of them happen with one of those filters active.

## Goals

**Product**

1. Filter the full database by reason, subject, notice type, country, publisher, year and whether the notice is paywalled, with live counts and no result cap. Notice type (retraction, expression of concern, correction, reinstatement) is its own filter, separate from reason. Only retractions are selected by default, as Retraction Watch's guide advises, and the other types and their counts are one click away (decided 2026-10-12).
2. Make results citable: the URL captures the whole query, including field searches, and every page shows the data date and links to the sources.
3. Stay fresh: no more than one working day behind the source CSV.
4. Search within any field without typing operators: add terms, choose whether results match any or all of them, exclude terms, and see the whole query summarized in plain language. This replaces the official search's wildcards and AND / OR / AND NOT. Typos are tolerated; if near-identical names get mixed up (such as Toronto and Torino), typo tolerance is reduced for that field.

**Learning** (kept separate so they don't justify product decisions)

1. Build and run a scheduled data pipeline: DuckDB locally, then GitHub Actions.
2. Get fluent with DuckDB and, optionally, Python data tools.
3. Run a self-hosted search server, and later build one embeddings feature.
4. Build natural-language filters, where an LLM turns a typed sentence into filters the user can check and edit.
5. Write server-side Next.js code (server components and server functions), not just client components.

## Non-goals

- Detecting misconduct or analyzing images. The site reports what Retraction Watch recorded and makes no new allegations.
- Author disambiguation, author profiles or author rankings.
- Accounts, comments or user-submitted content. Missing retractions get reported to Retraction Watch through its own submission form, which the site links to.
- Anything with an uncapped bill. LLM calls for natural-language filters need a provider with a hard spending cap, plus the site's own rate limit and cache (see Roadmap).
- Replacing Retraction Watch or Crossref, or appearing affiliated with either.

## Success metrics

**North Star: result clicks per week.** A result click is opening a record, or following a link to a notice or paper, from a list that was searched or filtered. It's a proxy for "found something useful". Each click is counted with the filters active at the time, so this needs no cookies or session tracking.

Supporting metrics:

- Share of result clicks made with a reason, subject or notice-type filter active. This tests the hypothesis.
- Visits that land on a URL with filters already applied, as a proxy for shared links.
- Zero-result rate for text searches.

Targets are set after four weeks of launch data, not before.

**Guardrails.** Breaching one is a bug, not a trade-off.

- Cost: the worst-case monthly bill is known in advance. Fixed costs, such as a small search server, are fine. Anything billed by usage needs a hard cap enforced by the provider, so a bug or an attack can't raise the bill past a set ceiling; the service going down at the cap is acceptable. Budget alerts that only notify don't count as caps.
- Freshness: at most one working day behind the source, with the data date shown.
- Correctness: row counts and facet counts match a direct DuckDB query on the same snapshot.
- Performance: page loads and search responses stay under budgets set in spec 002.
- Attribution: every page credits Retraction Watch and links the source. Where the site shows a citation, it gives both ISSNs, each labeled: 2692-4579 for the Retraction Watch Database and 2692-465X for the Retraction Watch blog (as registered on the ISSN Portal; checked 2026-10-12).

**Learning milestone:** the pipeline runs daily for 30 days, and failures send an alert.

## Validation

Before building features beyond the MVP, show the site to two or three people from each group and watch them try a real question.

## Risks

- **Misattribution.** Author names aren't disambiguated, so one name can belong to several people. Label author results as name matches, and don't show per-author counts.
- **Conflating notice types.** An expression of concern is not a retraction, and Retraction Watch's coverage of expressions of concern and corrections is selective, so their counts aren't representative (see Data caveats). Keep notice types visibly separate.
- **Misleading counts.** Revised versions, editorial-staff notices and approximate dates can all skew counts (see Data caveats). The facets should make these visible or excludable, not hide them.
- **Cleaning errors.** Test the cleaning against a pinned snapshot, and show the original values on record pages.
- **Building for one user.** The first user is the project's owner, who is on the researcher side. Check with other users before adding researcher-only features.
- **Upstream changes.** The CSV's columns or location may change. The pipeline then fails loudly and the site keeps serving the last good data. Records also change after they're entered: reasons get updated and new categories appear (the methodology note lists three notice types; the data now has four). So the daily diff reports changed records as well as new ones, and filter values come from the data, not a fixed list.

## Data caveats

These come from Retraction Watch's [user guide](https://retractionwatch.com/retraction-watch-database-user-guide/) (updated 2024-10-23) and its methodology note, [How The Retraction Watch Database Was Constructed](https://retractionwatch.com/wp-content/uploads/2023/12/Building-The-Database.pdf). Both were checked 2026-10-12. The note is older than the current data: it lists three notice types, and the data now also has reinstatements. Spec 001 has to handle each caveat, and the site has to explain them wherever they affect counts.

- **Reasons are Retraction Watch's classification, and they change.** Reasons come from the notice plus Retraction Watch's own checks of its blog posts, institutional misconduct findings and press coverage. They're updated when new information arrives, so counts by reason can change even for old retractions. The site labels reasons as Retraction Watch's classification.
- **Countries cover every author.** A record lists every country in its authors' affiliations, so country counts overlap and add up to more than the number of records. When an affiliation is missing, Retraction Watch enters the country most associated with the authors at the time, so some countries are inferred.
- **Expressions of concern and corrections are selective.** Retraction Watch aims to be comprehensive only for retractions. It adds expressions of concern and corrections mainly when they relate to existing retractions, its blog posts or high-profile studies, so their counts aren't representative.
- **Revised versions are separate entries.** When preprints, guidelines or reviews are revised under new DOIs, the original and each revision are all entered, and the revisions get "Revision" in their article type. The guide notes that this can inflate counts for journals and authors. The site hides revisions from results and counts by default, with an option to include them (decided 2026-10-12).
- **Some notices list the journal as the author.** When a notice only amends an earlier notice, the author becomes "Editorial Staff" plus the journal name, the affiliation becomes the publisher, and the country becomes the publisher's headquarters country.
- **Dates are approximate below the year.** An unknown day is recorded as the 1st, a month range uses its first month, and seasons and volume numbers are mapped to months. When a publisher overwrote the article page with the notice, the paper and the notice get the same date, so "time to retraction" would read as zero. When a notice's real date couldn't be found, the date Retraction Watch discovered it is used instead.
- **"Paywalled" describes the notice, not the paper.** It means a subscription was needed to see the notice's title or reason.
- **Coverage depends on how notices are found.** The database started from PubMed and is checked against Web of Science, Scopus, publisher sites and reader tips. Stealth retractions (articles removed without a notice) are found mostly through tips. Unverified: since the starting point was PubMed, biomedical fields may be better covered than others. Check before comparing subjects.
- **Terminology.** An article removed entirely counts as a retraction, however long it was removed for, including "withdrawn" articles. Corrections include errata, corrigenda and partial retractions. Expressions of concern cover almost every other editorial notice.

## Existing alternatives

| Alternative | What it does | Gap |
|---|---|---|
| Official Retraction Watch search | Field search over the database | No reason, subject or notice-type filter. Needs at least one criterion, and shows at most 50 entries (with a total count). |
| Retraction Watch CSV (Crossref GitLab) | Full data, updated daily | Needs cleaning and tooling |
| Crossref REST API | Metadata per DOI, including retraction status | Built for lookups, not browsing |
| OpenAlex | Search and abstracts over all works, with an `is_retracted` flag | The flag is yes/no only, with no reason or notice type. It marks 136,530 works as retracted (checked 2026-10-12), about twice Retraction Watch's retraction count. The difference hasn't been investigated. One possible factor: Retraction Watch's methodology note says some items labeled as retractions in PubMed or Web of Science are really errata, which it leaves out. |
| Feet of Clay Detector (part of Problematic Paper Screener), RetractoBot | Find citations to retracted papers | Overlaps with the planned "check a paper" feature, so that feature is not new |

The gap this project fills: faceted browsing of the full Retraction Watch data, including reason, subject and notice type, updated daily and free to use.

## How it runs

Once the site is public, nothing depends on the owner's computer. Three hosted pieces do the work:

| Piece | Where it runs | What it does | Cost control |
|---|---|---|---|
| Daily update | GitHub Actions, on a schedule | After Retraction Watch's daily update, starts a fresh machine, runs download → clean → load into the search server, then shuts down | Free for public repos. Without a payment method on GitHub, use beyond the free allowance is blocked, not charged (GitHub docs, checked 2026-10-12). |
| Search server | Typesense on Railway, always on | Keeps the search index on a persistent disk and answers every search | Railway's hard spending limit, set to $50 with an email alert at $10: at the cap, Railway takes the service offline rather than billing more. Worst case $50 a month (decision record 002). |
| Website | Next.js on Vercel | Rebuilds on every push to `main`. Its server code sends searches to the search server, so browsers never see a search key, and it limits each visitor's searches. | Free Hobby plan, which pauses at its limits (to verify in Phase 4) |

- If a daily run fails or is skipped, the site keeps serving the previous day's data, and GitHub emails whoever last edited the schedule.
- In public repos, GitHub switches off scheduled jobs after 60 days without repository activity. Spec 003 has to handle that.
- The admin key for loading data is an encrypted GitHub secret, never in the code. Every search goes through the website's server code, which keeps the search key secret and applies a rate limit. Natural-language searches (Phase 5) add the LLM key and a cache there.
- If the search index is lost, the next daily run rebuilds it from the CSV, so it needs no backups.

## Roadmap

| Phase | Output | Done when |
|---|---|---|
| 0. Framing | This brief, `CLAUDE.md`, decision record 001 | Reviewed and approved |
| 1. Data cleaning (spec 001) | DuckDB cleaning of the CSV, and the measured size of the search documents | Decision record 002 chooses the search engine and host, with its worst-case monthly cost |
| 2. Local search MVP (spec 002) | Next.js app and a local search server, with facets, counts and record pages | Spec 002's acceptance criteria pass locally |
| 3. Pipeline (spec 003) | Download → clean → diff → publish, locally and then on GitHub Actions, into the hosted search server (moved here from Phase 4 on 2026-10-14) | Runs unattended and fails loudly on schema changes |
| 4. Launch | The site, its rate limits and analytics, within the cost guardrail | Live, updating daily, recording metrics |
| 5. Natural-language filters | An LLM turns a typed sentence into filters the user can edit | A decision record picks an LLM provider whose spending can be hard-capped, and the feature's spec passes |
| 6+. Chosen from launch data | Candidates below | |

If decision record 002 confirms Typesense, Phase 5 uses its built-in natural-language search, which turns a sentence into a query and filters that the site can show as the same editable tags as Goal 4. Typesense's docs (checked 2026-10-12) don't mention caching LLM responses or limiting LLM calls, so the site needs its own rate limit and cache.

Phase 6+ candidates, each with the evidence that would justify it:

- **Check a paper.** Cheap and client-side, but it duplicates existing tools. Build it if researchers ask for it during validation.
- **Abstracts and topic search.** Fits the learning goals. Build it if the zero-result rate for text searches is high, or if validation users ask for it.

## Open questions

- Which analytics tool records custom events without cookies, within the cost guardrail? Decide in the launch spec.
- Name and domain.
