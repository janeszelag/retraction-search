# Spec 004: Launch

Status: approved by the owner, 2026-10-17. Changed 2026-10-27 with the owner's approval, after the owner bought the domain and answered the questions before the announcement: decisions, AC8, AC13, new AC14 and AC15, and the open questions. Phase 4 of the [roadmap](../../product-brief.md#roadmap).

## Problem

The site from spec 002 runs only on the owner's laptop, against a local search server. Spec 003 set up the hosted search server and its daily update, but nobody else can search it yet. Plan 002 left the hosting checks to this phase: what Vercel's Hobby plan allows, and what happens at its limits.

Upstream's 2026-10-15 export lost text and changed format ([data issues](../../data-issues.md#file-format)), so daily updates are failing and the hosted server keeps the 2026-10-14 snapshot. Nothing in this phase depends on that file. The site shows whatever snapshot the hosted server holds, with its date.

## Users

- **Visitors (researchers and journalists),** once the site is announced. They need it to answer as it does on the laptop, with the same counts.
- **The owner, who runs the site.** They need to know when it's down and what it costs.
- **The later iterations** (the site's own rate limits, analytics) and **Phase 5,** which build on the deployed site.

## Hypothesis

We believe the spec 002 site can run in public on Vercel's free plan in front of the hosted search server, within the brief's cost guardrail, with a firewall rule as its only rate limit until it's announced. We'll know when it has served the hosted snapshot for a week of daily updates, with no unexplained downtime and no bill beyond decision record [005](../../decisions/005-site-hosting.md)'s worst case.

## Decisions

Made 2026-10-15:

- The site goes live before upstream's export is fixed, but isn't announced. Until the owner announces it, search engines are asked not to index it. Phase 4 is done only once daily updates load again.

Made 2026-10-17, replacing the 2026-10-15 decision that this spec covers all of Phase 4:

- The first release has no Redis. A Vercel firewall rule limits requests per IP address, and spec 002's own per-visitor limits are off on the live site. The caps already bound the bill. Rate limits protect uptime, which matters little before the announcement.
- The site's own rate limits and analytics become later iterations, each with its own spec ([roadmap](../../product-brief.md#roadmap)). Decision record 005 lists the options checked for both.

Accepted with decision record [005](../../decisions/005-site-hosting.md), 2026-10-17:

- Vercel Hobby for the site, as the brief planned, with one firewall rate-limit rule.

Made 2026-10-27, with the owner's approval:

- **Name and domain:** the site keeps the name "Retraction search", at www.retraction-search.com. The owner bought the domain through Vercel on 2026-10-27. The bare domain redirects to `www`, and so does the project's `vercel.app` address, so search engines find one copy of the site.
- **Payment method:** buying the domain put a card on the Vercel account. Hobby still doesn't bill usage: past an allowance, Vercel pauses the feature (AC8). The card pays for the domain, a fixed $15 a year.
- **The announcement** comes without analytics, so its first weeks go unmeasured, and without a notice when the data is behind. Analytics stays a later iteration.
- **Indexing:** after launch, search engines may index the start and About pages only (AC15).
- **Downloads:** a firewall rule challenges every download request, so a script can't fetch the full file in a loop (AC14). Hobby allows one rate-limit rule, which the general limit uses, so downloads can't get a lower limit of their own.

## Acceptance criteria

"The live site" is the production deployment on Vercel. "The hosted server" is the Typesense server on Railway from spec 003.

**Hosting**

- AC1: The live site is built and deployed from `main` on Vercel's Hobby plan, and serves every page of spec 002 over HTTPS. A push to `main` that changes the site deploys it. A deployment can be rolled back to the previous one from Vercel's dashboard.
- AC2: Pull requests that change the site get a preview deployment that only the owner can open.
- AC3: The live site searches the hosted server, and every page shows the hosted snapshot's data date and commit, as it does locally.

**Keys**

- AC4: The site's search key on the hosted server can search and export only, as the local one does (spec 002 plan). A command creates or reuses it and writes it to an env file that isn't committed, without printing it. The daily update never touches it (spec 003, AC18).
- AC5: The search key lives only in Vercel's settings, marked sensitive, and in the owner's local env files. No page, script, response, build log or repository file contains it (spec 002, AC27, checked against the live site).

**Limits and cost**

- AC6: A firewall rule on Vercel limits requests per IP address before the site's server code runs. Its limit is high enough that a person browsing quickly never reaches it.
- AC7: On the live site, spec 002's per-visitor limits (AC28) are off by a setting, and the site needs no Redis. The log says so once when the server starts, not as a repeated error. Locally the limits stay on, and their tests still pass.
- AC8: Each hosted piece either has a spending limit enforced by its provider or can't bill for usage: Railway's $50 hard limit, and Vercel's Hobby plan, which pauses a feature past its allowance instead of billing it. The card on the Vercel account pays only for the domain, a fixed yearly price. Decision record 005 gives the worst-case month. This is a manual check, recorded with its date. (Changed 2026-10-27: it said "with no payment method".)
- AC14: A second Vercel firewall rule challenges every request for a download (`/api/export`) with Vercel's browser check, before the site's server code runs. A person downloading in a browser gets the file after the check. A script that can't pass the check gets no file. (Added 2026-10-27.)

**Monitoring**

- AC9: A scheduled check, every 6 hours and about 90 minutes after each daily update run, loads the live site and runs one search through it. When the check fails, it opens an issue, or comments on the open one, with what failed and when. The next successful check comments and closes it. The check doesn't print the site's address in public logs until the site is announced.

**Before the announcement**

- AC10: Until the owner announces the site, every page tells search engines not to index it, and `robots.txt` disallows everything. A setting in Vercel turns this off at launch, with no code change.
- AC15: Once indexing is on, search engines may index only the start page (the search page with no search, filter, sort or page set) and the About page. Results pages, record pages and the not-found page tell them not to index the page or follow its links, and `robots.txt` disallows `/api/`. `robots.txt` doesn't disallow those pages, since a search engine has to fetch a page to read its noindex. Built before indexing is turned on. (Added 2026-10-27.)
- AC11: On the live site against the hosted snapshot: the counts for spec 002's fixed set of test queries match a DuckDB query on the same snapshot (spec 002, AC30), and the automated accessibility check finds no WCAG 2.2 AA violations on the start, results, no-results, record and About pages (spec 002, AC32).
- AC12: Budgets for the live site, confirmed by the owner on 2026-10-19: the server response for spec 002's fixed set of test searches is under 500 ms at the 95th percentile, measured from the owner's laptop, and a shared URL reaches Largest Contentful Paint in under 2.5 seconds in Lighthouse's mobile test.

**Running it**

- AC13: The runbook (spec 003, AC21) covers the site, in plain terms: how it's deployed and rolled back, how to change the search key, how to change the firewall rule and the download challenge, how to turn on indexing at launch, and what happens at each provider's limit.

## Done when

All acceptance criteria pass. The daily update has loaded again and kept the hosted data current for seven consecutive days, with the live site serving it. Spec 003's unattended week can count for both. The owner has chosen the name and domain, turned on indexing and announced the site.

## Success metrics

- No provider bills beyond decision record 005's worst case, and the first full month's use of Vercel's allowances and Railway's egress is compared with its estimates.
- No day in the first month is lost to a paused Vercel feature.
- The firewall rule's blocks, as Vercel's firewall page shows them, stay rare for people browsing normally.

The brief's own success metrics wait for the analytics iteration.

## Non-goals

- The site's own per-visitor rate limits with a hosted store, and analytics of any kind, including counts of visits and downloads. Both are later iterations.
- Natural-language filters (Phase 5), which need the site's own rate limits first.
- Vercel Pro, several regions, or an uptime guarantee. Downtime at a provider's limit is acceptable under the cost guardrail.
- Fixing upstream's export. That stays with spec 003's open question.
- New search features, and changes to spec 002's pages.

## Open questions

- **Name and domain.** The brief's open question. The site can go live on its `vercel.app` address. A domain is a fixed yearly cost and needs to be chosen before the announcement. Answered by the owner, 2026-10-27: "Retraction search" at www.retraction-search.com (Decisions).
- **Announcing before analytics.** The brief sets targets after four weeks of launch data. If the site is announced before the analytics iteration, those first weeks go unmeasured. Answered by the owner, 2026-10-27: announce without analytics, and accept the unmeasured weeks.
- **What search engines may index after launch.** A record page lists author names, and names aren't identities: someone searching for a person could land on a record for someone else with the same name. One option is to let search engines index the start and About pages only, and keep results and record pages out of their indexes. Answered by the owner, 2026-10-27: that option (AC15).
- **A notice when the data is behind.** The footer shows the data date, which meets the freshness guardrail's "with the data date shown". While daily updates fail, as now, a visitor may not notice the date. The site could say when the data is more than a working day behind the source. Answered by the owner, 2026-10-27: not before the announcement. Daily updates load again since 2026-10-26.
- **Upstream's lossy export.** If upstream keeps the new format and its lost characters, daily updates can't resume, and this spec can't be done. That decision belongs to spec 003. Resolved for now: upstream's second export comes in UTF-8 without lost text since 2026-10-22, and loads since 2026-10-26 (spec 003, tasks 23–27). If the lossy export returns, the update stops at the download and search keeps the last good snapshot.
- **A separate limit for downloads.** Answered 2026-10-27: Hobby allows one rate-limit rule, within its 3 custom firewall rules (Vercel WAF docs, checked 2026-10-27), and the general limit uses it. The owner chose a challenge on downloads instead (AC14).
- **The budgets in AC12:** the owner confirmed them on 2026-10-19, from task 14's measurements of the live site (95th percentile 464 ms, median Largest Contentful Paint 2.27 s).
