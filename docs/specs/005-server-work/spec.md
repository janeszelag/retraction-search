# Spec 005: Less server work per page

Status: draft for the owner's review, 2026-11-02. Nothing here is approved, and no code has been written. How to build it: [plan 005](plan.md). The store it needs: proposed decision record [006](../../decisions/006-counter-store.md).

## Problem

Every page on the live site runs server code. Pages answer `private, no-cache, no-store`, so Vercel's CDN keeps none of them, and a repeat request for the About page costs the same kind of function run as the first.

In the 30 days to 2026-11-02, three crawlers (QlyzeBot, Google's and Meta's) took the site to 3 h 49 min of the 4 hours of Active CPU that Vercel's Hobby plan allows, and to 9.09 of its 10 GB of Fast Origin Transfer. About 299,000 requests cost about 46 ms of CPU and 30 KB of transfer each. At that rate a month's allowance holds about 313,000 pages, or 7 a minute. Meta's crawler alone sent about 160 a minute.

The firewall and `robots.txt` didn't prevent this, and they won't prevent the next one:

- `robots.txt` is voluntary, and one of the three crawlers fetched addresses it disallows.
- The firewall stops a crawler only after the owner has seen it and named it.
- The search page links to hundreds of filter addresses, and each of those links to hundreds more, so a crawler never runs out of new pages.
- The firewall's rate limit counts per address. All three crawlers stayed under it.

Past an allowance, Vercel can pause the site for up to 30 days. As of 2026-11-02, 660 s of CPU and 0.91 GB of transfer remain until the heavy days leave the 30-day window, around November 27.

Downloads are a larger risk per request, and they haven't caused trouble only by luck. The whole default view is a 64 MB file (14 MB with gzip), and the page links to it. One script fetching it once a minute stays well under the firewall's limit and would use the 10 GB in 3 to 12 hours, depending on how Vercel counts a streamed file.

## Users

- **Visitors (researchers and journalists).** They need the site to be up. They'd rather see a slightly older page than none.
- **The owner, who runs the site.** They need a crawler to be a matter for the next working day, not an emergency, and they need to hear about it before Vercel's 75% email.
- **The later iterations.** Phase 5's natural-language filters need the site's own limits first (spec 004).

## Hypothesis

We believe that serving repeat pages from the CDN, plus a site-wide ceiling on the pages and downloads the server produces, keeps any crawler that ignores `robots.txt` and the firewall inside Hobby's allowances for long enough to deal with it during a working day. We'll know when a week of ordinary traffic shows repeat pages answered without a function run, Usage shows a daily rate that fits the 30-day allowances, and a simulated crawl stops at the ceiling.

## Decisions

Proposed, for the owner to approve. The trade-offs behind each are in [plan 005](plan.md#trade-offs).

- **Cache pages at the CDN for a set time.** A new snapshot appears when the cache time runs out. There's no purge in the first release.
- **Bring forward a site-wide ceiling, not per-visitor limits.** The site's own per-visitor search limit would have stopped none of the three crawlers, since each spread across addresses or stayed under 60 a minute. Spec 002's per-visitor limits stay off on the live site.
- **Count downloads in records, site-wide.** One full download costs as much transfer as 470 to 2,100 pages, depending on how Vercel counts a streamed file.
- **Use Upstash Redis Free as the counter store,** with no card on the account (decision record [006](../../decisions/006-counter-store.md)).
- **Leave the pages as they are.** Measured, the page's size barely affects CPU, and once the start page is cached its size hardly matters. Only removing the filter sidebar made a clear difference, and that would change how filters work without JavaScript (decision record [003](../../decisions/003-ui-stack.md)).
- **Stay on Hobby.** Moving to Pro would need its own decision record, and a crawler would then cost money rather than a pause.

## Acceptance criteria

"Full-page request" means a browser or crawler loading an address, as opposed to the in-app request a browser makes when a visitor clicks a filter. "Ceiling" is the site-wide limit in AC7 and AC8.

**Caching**

- AC1: On the live site, a repeat full-page request for the same start page, results page, record page or About page, within the cache time, is answered by Vercel's CDN without running server code (`x-vercel-cache: HIT`).
- AC2: After the daily update loads a new snapshot, every page shows it within 2 hours. Every page shows the data date of the snapshot it was built from, so a cached page never claims to be newer than it is.
- AC3: These are never cached: `/api/*` answers, in-app requests, pages that couldn't reach the search server, and pages refused at a ceiling.
- AC4: When the search server can't be reached, a page already in the cache keeps being served for up to a day. Any other page answers with a server-error status and, with JavaScript on, says search is unavailable and shows the attribution. Without JavaScript that page is empty, which changes spec 002 AC29 (see open question 1).
- AC5: A cached page is the page anyone would have got: the same robots tags (spec 004 AC10, AC15), attribution and links. Nothing about one visitor is stored in it.
- AC6: Caching is controlled by a setting and is off when the setting is absent, so local runs and previews behave as they do today.

**Ceilings**

- AC7: The site counts the search and record pages it builds, across all visitors, in a fixed window. Pages answered by the CDN don't count, and neither does the About page. Past the ceiling, the site builds no more of them until the window ends.
- AC8: The site counts the records it sends in downloads, across all visitors, in a separate daily window. A download that would pass the ceiling is refused before it starts, and the Download CSV button says when to try again (spec 002 AC28's notice).
- AC9: A refused page has the same status and message as AC4, and runs no search. It costs at most a third of a normal search page's CPU and at most 5 KB of transfer.
- AC10: Both ceilings and their windows are settings. Without them, or without a store, the ceilings are off.
- AC11: If the store can't be reached or refuses a command, pages and downloads carry on as if the ceilings were off. The log says so at most once a minute.
- AC12: At the default ceilings, the store stays within its free monthly allowance even during a flood, because once a ceiling is reached the site stops contacting the store until the window ends.
- AC13: The store holds only totals. No address, query or anything else about a visitor is stored, and every counter expires.

**Alerts**

- AC14: `/api/health` reports whether a ceiling was reached in the last window and whether the store is working. Reading it can't use up the store's allowance.
- AC15: The scheduled site check treats a reached ceiling or a failed store as a failure, so it opens a `site-check` issue saying which.

**Firewall (the owner's steps, recorded as manual checks)**

- AC16: A firewall rule denies `/api/export` to clients that send no `Sec-Fetch-Site` header. The Download CSV button still works in Chrome, Firefox and Safari, and a request from `curl` gets 403. This replaces spec 004 AC14's rule, which only logs.
- AC17: Bot Protection runs in Log mode for a week. The owner reviews what it would have caught, and decides how to use the last custom firewall rule (plan 005, "Firewall").

**Checking the result**

- AC18: A simulated crawl of a preview or local deployment confirms that AC7 stops it and that AC15's alert fires.
- AC19: For the week after each pull request ships, the owner records daily Active CPU, Fast Origin Transfer, invocations and CDN requests from Vercel's Usage page, next to plan 005's estimate.

## Done when

All acceptance criteria pass, and one week of Usage after the last pull request fits the 30-day allowances at its daily rate. The runbook says what to do when the ceiling is reached.

## Success metrics

- No day is lost to a paused Vercel feature.
- Function invocations per CDN request fall after caching ships.
- The site check reports a crawl before Vercel's 75% email does.
- The ceiling is reached rarely. If people are refused in ordinary use, it's set too low.

## Non-goals

- The per-visitor search limit on the live site. Analytics of any kind, beyond the totals in AC7 and AC8.
- Caching in-app requests. Clicking a filter runs server code as it does today.
- Purging the cache when a snapshot loads.
- Moving off Hobby or off Vercel. Removing or restructuring the filter sidebar, the links or the number of results per page.
- A guarantee against a determined attacker. A flood that imitates a browser still counts toward Vercel's 1,000,000 requests, and only the firewall can stop those.

## Open questions

Each has a recommendation, for the owner to accept or change.

1. **An empty page without JavaScript when search is down or a ceiling is reached (AC4).** Next.js 16.4.3 gives any page that doesn't answer 200 an empty HTML body, and a page answering 200 would be cached. So keeping failures out of the cache costs visitors without JavaScript their message and attribution, for pages not in the cache. The site's not-found pages already behave this way. Recommended: accept it, and change spec 002 AC29.
2. **How old a page may be (AC2).** Recommended: fresh for 1 hour and usable for 1 more, which is well inside the brief's one working day. A longer time saves more on repeat crawlers but delays a new snapshot.
3. **Where to set the ceilings (AC7, AC8).** Recommended: 1,600 pages in 6 hours and 100,000 records in 24 hours. If a crawler held both ceilings for 30 days, that would use about 61% of the CPU allowance and at most 87% of the transfer allowance (plan 005). Until about November 27, 144 pages in 6 hours fits what remains. People's use on a quiet day should be read from Usage first, because that value is low.
4. **A new account with a new provider (decision record 006).** Recommended: yes, with no card.
5. **A full download can now be refused (AC8).** One file still has no row cap (spec 002 AC23), but about one full download a day fits under the recommended ceiling. Recommended: accept it, since the brief's users can get the whole dataset from Crossref's CSV.
6. **Scripts lose the download (AC16).** Recommended: accept it, for the same reason. A script can still fetch Crossref's file.
