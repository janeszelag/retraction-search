# Plan 005: Less server work per page

Status: draft for the owner's review, 2026-11-02. How to build [spec 005](spec.md). Facts about other services were checked on 2026-11-02 and are listed under [Checked facts](#checked-facts). Measurements were taken the same day.

## Recommendation

Do four things, in this order, and stay on Hobby:

1. **Today, the owner:** deny downloads to clients that aren't browsers, and turn on Bot Protection in Log mode. Both are firewall settings and take a few minutes. The first closes the fastest way to lose the site.
2. **First pull request:** cache pages at the CDN for an hour, and make failed pages answer with a server error so they're never cached.
3. **Second pull request:** add site-wide ceilings on pages and downloads, with their counters in Upstash Redis Free, and an alert when one is reached.
4. **Leave the pages' size alone.** It isn't what uses the CPU.

Each layer covers what the one before it can't. Caching can't help with addresses nobody has asked for yet, which is most of a crawl. The ceiling can't stop requests from counting toward Vercel's 1,000,000. Only the firewall stops them before they count, and it stops only what it can recognize.

## How it fits together

```
Visitor or crawler
   │
   ▼
Vercel firewall ── IP blocks, AI crawlers denied, one rate limit per address,
   │               and non-browser downloads denied (AC16). A request stopped
   │               here counts toward nothing.
   ▼
Vercel CDN ─────── a repeat full-page request ends here (AC1): one CDN request,
   │               no function run, no Active CPU, no origin transfer.
   ▼
Server code ────── one site-wide counter in Upstash (AC7, AC8). Past a ceiling,
   │               a small server-error answer and no search.
   ▼
Typesense on Railway
```

## What stops pages being cached today

- **The route is dynamic.** The search page reads `searchParams`, the footer calls `connection()`, and `siteOrigin()` reads `headers()`. Next.js gives any such page `private, no-cache, no-store`.
- **A page can't set its own response headers.** Only `next.config.ts`, a route handler or `proxy.ts` can. `proxy.ts` is no use here, because it runs before the CDN on every request, cached or not.
- **Failed pages answer 200.** `<Unavailable>` and `<SearchLimitReached>` render at HTTP 200, so the CDN would keep them for the whole cache time. This is the real blocker.
- **`checkLimit`** needs each visitor's address, which a cached page never sees. It's already off on the live site (`RATE_LIMITS=off`). The two can't work together, so the build refuses to run with both on.
- **`siteOrigin()` is harmless.** The host is part of Vercel's cache key.
- **Nothing else varies by visitor.** The pages read no cookies, and the only clock read in a page is a fallback year when the search server is down.

## Owner's setup

| When | Step |
|---|---|
| Today | Change the download rule and turn on Bot Protection in Log mode ([Firewall](#firewall-ac16-ac17)). |
| Before the first pull request ships | Set `PAGE_CACHE_SECONDS=3600` for Production in Vercel. It's read at build time, so it takes effect with the next deployment. |
| Before the second pull request ships | Create a free Upstash account with no card, and one Redis database in `us-east-1`, next to `iad1`. Add its `rediss://` address to Vercel as `REDIS_URL`, marked sensitive, for Production only. |
| When the second pull request ships | Set `CEILING_PAGES` and `CEILING_RECORDS` in Vercel, from spec 005's open question 3. |

## Spikes first

**S1: does the CDN keep a page marked `private`?** Vercel's docs say `Vercel-CDN-Cache-Control` overrides `Cache-Control`, including `private`. One line on the CDN cache page reads the other way, so this needs a live test. Send only `/about` through the new header, in a small pull request, and request it twice with `curl`. Passing looks like `x-vercel-cache: HIT` on the second request. `/about` has no search to go stale, and production needs no preview bypass secret. If it fails, stop and rethink the caching half of this plan. The ceilings don't depend on it.

**S2: does a stale page survive an outage?** AC4 relies on `stale-if-error` for an answer of 500 from a page. Vercel's docs list the directive but don't describe this case. Load the start page, wait 2 hours, restart the search server on Railway at a quiet time, and request the page during the restart. Request a page that isn't cached twice during the same restart: both should answer `x-vercel-cache: MISS`, which confirms a 500 is never kept (AC3). If the CDN answers the stale page's address with the error instead, AC4's first sentence is dropped and the failure page is what visitors see.

**S3: how much does the store add to a page?** After the second pull request, repeat `check:speed` against the live site with the ceilings on, and compare with the 500 ms budget (spec 004 AC12). Upstash in the same region should add about a millisecond, but that's unverified.

## Caching (AC1–AC6)

`next.config.ts` sets the header, since a page can't. `missing` keeps in-app requests out: they carry an `rsc` header, and their answer differs from the full page's.

```ts
const seconds = Number(process.env.PAGE_CACHE_SECONDS ?? 0);

const nextConfig: NextConfig = {
  async headers() {
    if (!seconds) {
      return [];
    }
    const value = `s-maxage=${seconds}, stale-while-revalidate=${seconds}, stale-if-error=86400`;
    return ['/', '/about', '/record/:id'].map((source) => ({
      source,
      missing: [{ type: 'header', key: 'rsc' }],
      headers: [{ key: 'Vercel-CDN-Cache-Control', value }],
    }));
  },
};
```

Under `next start`, the header appeared on the start, results, About and record pages, and on a missing record's 404, and not on a request carrying `rsc`.

- **`Vercel-CDN-Cache-Control`** is read by Vercel's CDN and no other cache, so browsers keep seeing `no-store`. A visitor reloading a page always asks the CDN.
- **The cache time** comes from the brief's limit of one working day and from `update.yml` running at most a few times a day. A page is fresh for an hour, and for another hour it's served while a new copy is built in the background. So a page can be 2 hours behind the search server, and AC2 follows.
- **`stale-while-revalidate` saves waiting, not CPU.** A stale request still runs one function, in the background.
- **A cached 404 is fine.** A record that a new snapshot adds appears at most 2 hours late, and only if someone asked for it before it existed.
- **The cache ends with the deployment.** Vercel keeps cached pages per deployment, so a deploy starts empty, and skew between a page and the site's scripts can't happen.

**A new snapshot** appears by the cache time running out. The options considered, all left out of the first release:

| Option | Gain | Cost |
|---|---|---|
| Time only (chosen) | No secrets, no new step in `update.yml`. | A page can be up to 2 hours behind. A download started from an old page gets the new snapshot's records, and the file name says so. |
| Deploy hook at the end of `update.yml` | Clears the cache for free, since each deployment has its own, and allows much longer cache times. | A rebuild for every snapshot. It moves Hobby's single rollback target, and doesn't go live while the site is rolled back. |
| Purge by tag from `update.yml` | Precise, and pages can be kept for days. | Needs a Vercel token in GitHub, and that token's reach is wide. Tags on a header from `next.config.ts` are unverified. |
| A site route that purges, called with a shared secret | No Vercel token outside Vercel. | A new public route and a new secret to look after. |

If a week of Usage shows that repeat crawlers arrive further apart than 2 hours, the deploy hook is the next step.

## Failed pages (AC3, AC4, AC9)

A failed page has to answer something other than 200 or the CDN keeps it. These are the results under `next start`, on Next.js 16.4.3:

| What the page does | Status | HTML body | Would the CDN keep it? |
|---|---|---|---|
| Renders `<Unavailable>`, as today | 200 | Full | Yes |
| Calls `notFound()` | 404 | Empty | Yes |
| Calls `forbidden()` (experimental) | 403 | Empty | No |
| Calls `forbidden()` in `generateMetadata` | 200 | The normal page | Yes |
| Throws an error | 500 | Empty | No |

"Empty" means a document with no visible content, plus the page's data. The browser then draws the nearest `error.tsx` or `not-found.tsx`. Moving the boundary into a route group or the record segment changed nothing, and a missing record's page behaves this way today. Next.js's source sets the 500 and sends this document for any error before the first byte of the page, and `error.tsx` doesn't run on the server. So without JavaScript these pages are blank, and that's spec 005's open question 1.

The plan: the search and record pages throw when the search can't run or a ceiling is reached, and a new `app/error.tsx` draws the message, a retry link and the attribution.

- **A thrown error rather than `forbidden()`,** because it's a stable part of Next.js, and because a server error is what `stale-if-error` is for.
- **One message for both causes.** "Search is unavailable right now" is true of both, and `error.tsx` then needs no way of telling them apart. There's no wait time to give, since a page can't set `Retry-After`.
- **The 500 is cheap.** The refused page took 3.3 ms of CPU locally against 14.5 ms for a search page, and 3.5 KB with gzip against 27 KB.
- **A refused in-app request** lands in the same `error.tsx`. An end-to-end test covers it.
- `<Unavailable>` becomes the body of `error.tsx`. `<SearchLimitReached>` stays for local use, where the per-visitor limits stay on (spec 004 AC7).

## Ceilings (AC7–AC13)

The rules live with the existing limits, in the same split: `web/lib/ceiling.ts` is pure and unit-tested, and `web/lib/server/ceiling.ts` talks to the store.

```ts
// Throws nothing and never waits long: a store that fails counts as no ceiling.
export async function checkCeiling(kind: 'pages' | 'records', amount = 1): Promise<CeilingCheck>;
```

- **Pages.** The search and record pages call it first, before any search. A hit from the CDN never reaches it, and the About page doesn't call it, so there's always something to read.
- **Downloads.** `/api/export` calls it after `startExport`, which knows the total before streaming, with `amount` set to that total. Past the ceiling it answers 429 with `Retry-After`, which a route handler can set. `toolbar.tsx` gets its own wording for it, since the existing notice talks about "files per hour".
- **The count.** `CounterStore` gains `add(key, amount, ttlSeconds)`: `INCRBY`, then `EXPIRE` only when the result equals `amount`, which means the key is new. The existing `increment` uses `MULTI` and costs at least two commands every time. It stays as it is for the per-visitor limits.
- **After a ceiling is reached,** the instance remembers the end of the window and doesn't call the store again until then. It keeps this on `globalThis`, as the store itself is kept, because Next.js loads several copies of a module. This is what bounds the store's commands during a flood.
- **Failing open.** The check has the existing 500 ms timeout, and an error counts as "ok". Logging follows the existing once-a-minute rule. A ceiling that fails open is the accepted risk: if the store is down during a crawl, the site is back where it is today, with the alert still firing.
- **Settings.** `CEILING_PAGES`, `CEILING_PAGES_WINDOW` (default 21600 seconds), `CEILING_RECORDS` and `CEILING_RECORDS_WINDOW` (default 86400). If a limit or `REDIS_URL` is missing, that ceiling is off, and the log says so once when the server starts. Changing one needs a redeploy.
- **Keys.** `ceiling:pages:<window index>`, holding one number. Each expires after two windows, so `/api/health` can read the window before.

**Commands a month.** The most the default ceilings can use is 192,000 `INCRBY`, 120 `EXPIRE` for pages and a few hundred for downloads, plus at most 43,200 reads per instance from health (below). That's about 240,000 of the free 500,000. Raising `CEILING_PAGES` above about 3,800 would pass 500,000, and at that point a unit test should fail.

## Alerts (AC14, AC15)

`/api/health` adds `ceilings: { pagesReached, recordsReached, store }`, for the current or last window. It keeps the store's answer in memory for 60 seconds, so a script hammering it can't spend the store's allowance. It still answers `Cache-Control: no-store`, so the site check keeps seeing the search server directly, whatever the CDN holds.

`site-check.js` gains a step after `health` that fails on a reached ceiling or a failing store, and says which. Its `start page` step may now be answered by the CDN, which is fine, since `health` runs a real search. The check runs every 6 hours, and the two-window keys mean a ceiling reached between checks is still seen.

The issue's comment should point to the runbook's new section: read Firewall traffic, block what can be named, and turn on Attack Mode if nothing can. Attack Mode is free on all plans, challenges visitors for 1, 6 or 24 hours, and lets verified bots through. Scripts can't pass a challenge, so the site check also fails while it's on.

## Firewall (AC16, AC17)

Hobby allows 3 custom rules, and 2 are used. Editing the download rule keeps the third free.

**Downloads, today.** In Firewall, edit the rule that logs `/api/export`: add the condition *Request Header* `sec-fetch-site` *does not exist*, and change the action to Deny. Browsers always send this header to an HTTPS site, and scripts can't remove it there. Non-browser clients don't send it: Node's `fetch` sends `sec-fetch-mode` but not this one (tested 2026-11-02), and `curl` sends neither. `Sec-Fetch-Site` has been in every major browser since March 2023.

Check: `curl -sI 'https://www.retraction-search.com/api/export?q=zzzz'` answers 403, and Download CSV works in a browser. What's lost is the log of allowed downloads (spec 004 AC14) until the ceiling counts them, and any script that used this address. A headless browser gets through, so the ceiling still matters.

**Bot Protection, today.** Set it to Log under Firewall, Bot Management. It blocks nothing. A week later, read what it would have caught.

**The last custom rule, after that week.** There are two uses for it, and the log decides:

| Option | Covers | Cost |
|---|---|---|
| Deny search addresses from clients with no `sec-fetch-site` | Filter pages only, which is where a crawl gets its endless addresses | A `query` condition needs a named parameter, so the rule repeats its conditions for each of the keys the site's links use. The conditions are verified for headers, inferred for queries. Link previews of a filtered search stop working. |
| Bot Protection on Challenge, with a bypass rule for the site check | Every address | Needs a secret header on the site check. People it suspects see a challenge. |

## Measurements

**Live, 2026-11-02.** All three answered `private, no-cache, no-store` and `x-vercel-cache: MISS`.

| Page | Uncompressed | As served (Brotli) |
|---|---|---|
| Start page | 392,254 B | 36,441 B |
| A search | 364,813 B | 33,375 B |
| About | 42,383 B | 8,485 B |

**The cost of a page.** Vercel's Usage page gave 13,740 s of Active CPU and 9.09 GB of origin transfer for about 299,000 requests: 46.0 ms and 30.4 KB each. The last day alone gave 43.0 ms and 29.0 KB. Transfer that close to the compressed size suggests origin transfer counts compressed bytes, though Vercel's docs don't say so.

**Local variants.** A production build of Next.js 16.4.3, run against a local Typesense holding the 2026-10-23 snapshot, with `RATE_LIMITS=off`. Each variant loaded 171 addresses (the start page, 80 with one filter, 80 with two, 10 records) for 5 rounds after warming up. CPU comes from the process tree's times.

| Variant | CPU per page | Average with gzip | Start page with gzip |
|---|---|---|---|
| As built, first run | 15.7 ms | 25.3 KB | 37.8 KB |
| As built, last run | 13.5 ms | 25.3 KB | 37.8 KB |
| Result rows as client components | 15.1 ms | 25.3 KB | 38.5 KB |
| Filter lists capped at 40 values | 15.9 ms | 23.9 KB | 32.9 KB |
| Filter lists capped at 12 values | 15.3 ms | 22.3 KB | 28.9 KB |
| No links in filter rows or results | 14.9 ms | 23.5 KB | 35.8 KB |
| Client rows, capped at 40 | 13.6 ms | 23.9 KB | 33.7 KB |
| 10 results a page instead of 20 | 13.1 ms | 21.8 KB | 32.3 KB |
| No filter sidebar | 11.9 ms | 15.7 KB | 20.1 KB |

The two runs of the unchanged site differ by 15%, so CPU differences smaller than that mean nothing. Only removing the sidebar stands clearly outside that noise. Live pages cost about 3 times the local CPU, and the likely reasons are slower machines, TLS to Typesense and cold starts. That ratio is an assumption wherever it's used below.

**What makes the start page large.** Of its 41 KB with gzip, React's copy of the page for the browser is 61%, the sidebar's HTML 15% and the results' HTML 22%. Class names are 98 KB uncompressed but nearly vanish under compression. So cutting raw HTML, as client components do, saves almost nothing: the 392 KB is mostly repetition.

**Other pages, local:**

| Page | CPU | With gzip |
|---|---|---|
| Search pages only (161 addresses) | 14.5 ms | 27.0 KB |
| About | 3.7 ms | 8.5 KB |
| Record | 4.0 ms | 7.7 KB |
| Refused by a thrown error | 3.3 ms | 3.5 KB |

**A download of the default view,** local: 67,637 records, 64.3 MB uncompressed, 14.2 MB with gzip, 2.8 s, 1.3 s of CPU. That's 951 B a record, or 210 B with gzip. CPU isn't the limit here. Transfer is, and whether Vercel counts a stream's raw or compressed bytes is unknown.

## Estimate

**Caching, replaying the same 299,000 requests.** The share answered by the CDN is the unknown. The site has no record of which addresses crawlers asked for, and Hobby's logs last an hour.

| Share from the CDN | Active CPU (limit 4 h) | Origin transfer (limit 10 GB) | Likely when |
|---|---|---|---|
| 0%, today | 3 h 49 min | 9.09 GB | |
| 10% | 3 h 26 min | 8.18 GB | One crawler working through new addresses |
| 50% | 1 h 55 min | 4.54 GB | Several crawlers overlapping within the hour |
| 90% | 23 min | 0.91 GB | Monitors, a link going around, the start page |

A crawler that remembers where it's been gets almost nothing from the cache. That's why caching alone doesn't meet the aim.

**The ceiling, at 30 days of a crawler holding it.** Taking Usage's 46.0 ms and 30.4 KB per page, and 951 B a record as the worst case:

| Ceiling | Pages in 30 days | Active CPU | Origin transfer |
|---|---|---|---|
| 1,600 pages in 6 hours | 192,000 | 2 h 27 min (61%) | 5.84 GB (58%) |
| 100,000 records a day | | Under 1 min a day | 0.6 to 2.9 GB (6% to 29%) |
| Both | | 62% | 64% to 87% |
| 144 pages in 6 hours, until about November 27 | 576 a day | 26 s a day | 18 MB a day |

The last row uses what's left: 660 s of CPU over 25 days is 26 s a day. CPU runs out before transfer.

**A flood of 160 requests a minute, from clients the firewall doesn't recognize.** A refused page is estimated at 10.6 ms live, which is the local ratio applied to 46 ms.

| Limit | Today | With the ceiling |
|---|---|---|
| Active CPU | 1.4 days | 5.4 days |
| Origin transfer | 1.4 days | 10.2 days |
| 1,000,000 invocations and CDN requests | 4.3 days | 4.3 days |

So the ceiling gives about 3 times as long, and then the request limit decides. A refusal still counts as an invocation, because the code has to run to refuse. This is the honest limit of "can't threaten the site": the alert arrives within about 6 hours, and the owner then has 4 days to name the crawler or turn on Attack Mode. At 14 requests a minute, the rate of the slowest crawler, the request limit is about 50 days away.

## Tests

| What | How |
|---|---|
| AC1, AC2, AC3, AC5 | Manual on the live site with `curl`, recorded with its date: `x-vercel-cache` on a repeat, on an `rsc` request and on `/api/health`. A new snapshot's date appears within 2 hours. An end-to-end test covers the header under `next start`. |
| AC4, AC9 | End-to-end, against a search server that's down: the status, the message and the attribution with JavaScript on. Manual for S2. |
| AC6 | Unit test of the headers with and without the setting. The build refuses `PAGE_CACHE_SECONDS` together with limits on. |
| AC7, AC8, AC10, AC11, AC12, AC13 | Unit tests with a fake store, as `web/lib/server/rate-limit.test.ts` does: windows, amounts, no store call after a ceiling, a failing store, and a count of commands per page. A test computes the month's commands at the defaults. |
| AC14, AC15 | Unit tests for `health` and `site-check.js`, with fake answers, in the existing files. |
| AC16, AC17 | Manual: `curl` and a browser, as above. |
| AC18 | A script requests new addresses against the local stack with low ceilings set, and confirms the refusals, the health report and the site check's failure. |
| AC19 | Manual: the Usage figures, in a table here. |

`check:speed -- --url` would time the cache once pages are cached. It adds an unused query parameter, which changes the cache key and forces a build, so it keeps timing the server.

## Order of work

1. The owner's firewall steps, today.
2. S1, then the caching and failed-page changes, in the first pull request.
3. A week of Usage against the estimate. Read Bot Protection's log.
4. The owner creates the Upstash database and accepts decision record 006.
5. The ceilings and alerts, in the second pull request.
6. S3, AC18 and the closing check.

The first pull request is small and doesn't need the store, so it goes first with only 660 s of CPU left. It doesn't protect against new addresses, so the margin stays thin until the second ships.

## Trade-offs

| Option | What it would do | Cost | Verdict |
|---|---|---|---|
| CDN caching | Ends repeat requests at the CDN | Pages up to 2 hours old, blank failed pages without JavaScript | **Yes.** Small, and it pays on every repeat |
| Site-wide ceiling | Bounds pages and downloads, whoever sends them | A new provider, and people refused during a crawl unless their page is cached | **Yes.** The only bound that doesn't depend on recognizing the crawler |
| Per-visitor limits (decision record 005's plan) | Limit each address to 60 pages a minute | A store call on every page | No. None of the three crawlers would have been stopped |
| Vercel's rate-limit SDK with one fixed key | A site-wide count with no new provider | Hobby allows one rate-limit rule, so this gives up the per-address firewall limit, and windows stop at 10 minutes | No. That rule is the only stop before requests count |
| Rate limit by JA4 instead of address | Could catch a crawler spread across addresses | All visitors with the same browser share one counter | No |
| Lighter pages (caps, 10 results, client rows) | 6% to 14% off transfer, no clear change in CPU | Behavior changes, and work | No. Revisit if transfer becomes the limit |
| Filters loaded separately, or as a form | Cuts the page by about 38%, and takes away the links a crawl follows | A second request per page, and filters without JavaScript go (decision record 003), a large rewrite | Not now. The next step if crawlers keep arriving |
| Capping one download's rows | A smaller file, a simpler limit | Changes spec 002 AC23 | No. The ceiling leaves AC23 standing |
| Cloudflare in front of Vercel | Its free plan could block and cache | Vercel recommends against a proxy, Bot Protection stops working behind one, and a second cache to coordinate. Its limits are unverified | No |
| Vercel Pro | $20 a month with $20 of credit, then billed by use. Spend Management can pause the site at a set amount, a few minutes late | A crawler costs money instead of a pause, and it needs a new decision record | No. It moves the problem to the bill |

## Changes to other documents

None are in this pull request, to keep clear of the open runbook changes. They come with the work:

- **Spec 002:** AC29 (open question 1), and a note on AC23 (open question 5).
- **Spec 004:** AC7 ("the site needs no Redis"), AC9 (what the check reads) and AC14 (deny instead of log). Plan 004 still says 50 results a page; the code has 20.
- **Decision record 005:** "Later iterations", which 006 settles for the store.
- **Runbook:** the Upstash database, the new settings, what to do when a ceiling is reached, Attack Mode, and rollback of caching (unset `PAGE_CACHE_SECONDS` and redeploy).
- **`CLAUDE.md`:** the stack's line on `RATE_LIMITS=off`, and any new command.
- **Product brief:** the roadmap's line on the site's own rate limits.

## Checked facts

All checked on 2026-11-02. The date in brackets is the page's own.

| Fact | Source |
|---|---|
| `Vercel-CDN-Cache-Control` has top priority, from a function or config. A `next.config.js` CDN header overrides a function's `Cache-Control`, including `private` | [Cache-Control headers](https://vercel.com/docs/headers/cache-control-headers) (2026-09-14), [personalized pages guide](https://vercel.com/kb/guide/cdn-cache-personalized-pages) (2026-11-02) |
| Cacheable: GET or HEAD, status 200, 404, 410, 301, 302, 307 or 308, up to 10 MB (20 MB streaming), no `set-cookie`. Times are best effort | [CDN cache](https://vercel.com/docs/cdn-cache) (2026-09-14) |
| A hit runs no function. Cached responses are scoped to their deployment. Failed revalidation keeps the last good response | [Cache status](https://vercel.com/docs/caching/cache-status) (2026-09-15) |
| Cache keys can't be configured. Purge is on all plans | [Purge](https://vercel.com/docs/cdn-cache/purge) (2026-09-03) |
| Order of work at the edge: firewall, proxy, cache, function | [Infrastructure](https://vercel.com/docs/infrastructure) (2026-08-28) |
| Hobby: 4 h Active CPU, 10 GB Fast Origin Transfer, 1,000,000 invocations, 1,000,000 CDN requests, 3 custom rules | [Hobby plan](https://vercel.com/docs/plans/hobby) (2026-09-14) |
| Past a limit, visitors see `503 DEPLOYMENT_PAUSED` | [Paused deployments](https://vercel.com/kb/guide/why-is-my-account-deployment-blocked) |
| Invocations count every request, whether or not it succeeds | [Functions pricing](https://vercel.com/docs/functions/usage-and-pricing) (2026-06-16) |
| Denied, challenged or rate-limited traffic incurs no CDN requests or Fast Data Transfer | [WAF usage and pricing](https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing) (2026-06-16) |
| Rate limits on Hobby: one rule, keyed by IP or JA4, windows of 10 s to 10 min, 1,000,000 allowed requests | [WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) (2026-08-28) |
| A fixed `rateLimitKey` makes a rule "effectively global" | [Rate limiting SDK](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting-sdk) (2026-07-23) |
| Conditions: `header` with `nex` tests a missing header. `query` needs a `key`. Attack Mode runs for 1, 6 or 24 hours | [`vercel firewall`](https://vercel.com/docs/cli/firewall) (2026-09-16) |
| Attack Mode is on all plans, free and unlimited, and lets known bots through | [Attack Mode](https://vercel.com/docs/vercel-firewall/attack-mode) (2026-08-11) |
| Bot Protection is Log or Challenge, excludes verified bots, and doesn't work behind a proxy | [Bot management](https://vercel.com/docs/bot-management) (2026-09-10) |
| Pro: $20 a month with $20 of credit. Spend Management can pause, some minutes late | [Pro plan](https://vercel.com/docs/plans/pro-plan) (2026-09-15), [Spend Management](https://vercel.com/docs/spend-management) (2026-09-18) |
| `Sec-Fetch-Site` is a forbidden header, in all major browsers since March 2023, sent only to trustworthy URLs | [MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site) |
| Next.js sends a dynamic page `private, no-cache, no-store`. `_rsc` must stay in a CDN's key | [CDN caching guide](https://nextjs.org/docs/app/guides/cdn-caching) (2026-08-25) |
| A 500 for an error before the shell, with an empty `__next_error__` document | Local test, and Next.js's `app-render.tsx` as described in [vinext #4466](https://github.com/cloudflare/vinext/pull/4466). Next.js's docs don't state it |

## Still open

- **Unverified:** whether origin transfer counts a streamed download's raw or compressed bytes. The first real download after the rule change, on a quiet day, could settle it from Usage. Until then the ceiling assumes raw.
- **Unverified:** that a firewall `query` condition takes `ex`. It's documented for headers only.
- **Unverified:** that Vercel applies `stale-if-error` to a page's 500 (S2).
- **Unknown until measured:** the share of real traffic the CDN answers, and how much of the live 46 ms is cold starts.
- **Not in the figures here:** Provisioned Memory (360 GB-hrs on Hobby). The owner should read it from Usage. Fewer function runs should lower it.
- **A side finding:** without JavaScript, a missing record's page is blank today, as the failure pages will be.
