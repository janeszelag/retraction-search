# Plan 004: Launch

Status: approved by the owner, 2026-10-17. How to build [spec 004](spec.md). Decision record [005](../../decisions/005-site-hosting.md) (Vercel Hobby, one firewall rule, no Redis or analytics in the first release) applies.

## How it fits together

```
Visitor's browser
   │ HTTPS
   ▼
Vercel: CDN and firewall ── one rate-limit rule per IP address (AC6)
   │
   ▼
Next.js server code, one region (Vercel Hobby), own limits off (AC7)
   └──► Typesense on Railway (HTTPS, the site's search key)   spec 003

GitHub Actions
   ├── update.yml, daily ──► Typesense (admin key)            spec 003
   └── site-check.yml, every 6 h ──► the live site            AC9

Owner's laptop
   └── npm run site-key -- --server-env .env.hosted          AC4
```

The site's code is spec 002's. This phase adds a setting that turns its own limits off, an indexing switch, a health route, a key command and a monitoring workflow. Everything else is settings in Vercel and GitHub.

## Owner's setup

These need accounts, so they're the owner's steps. None of them takes a payment method.

1. **Railway:** note the search server's region (service settings). The site's functions go in the nearest Vercel region.
2. **Site key:** run `npm run site-key -- --server-env .env.hosted`. It writes `TYPESENSE_SEARCH_KEY` into that file.
3. **Vercel:** sign up with GitHub on Hobby, and import the repository with `web` as the root directory and the Next.js preset, without variables. The import deploys at once, and Vercel's default protection, Standard Protection, leaves the production domain public, so the first deployment has nothing it can search. Then, in the project's settings: Deployment Protection set to Vercel Authentication for All Deployments until spike S1 is done, Node.js Version 22.x under Build and Deployment, and the function region nearest Railway under Functions (Vercel docs, checked 2026-10-18).
4. **Vercel variables,** for Production and Preview: `TYPESENSE_URL`, `TYPESENSE_SEARCH_KEY` (marked sensitive) and `RATE_LIMITS=off`. `SITE_INDEXING` stays unset until launch.
5. **Firewall rule:** rate limit by IP address on every path except `/_next/static/`, with the window and limit from spike S2.
6. **GitHub:** create a `site` environment, limited to `main`. Add the secret `SITE_URL` once production is open: until then the site check would only meet Vercel's login, so without the secret it passes without loading anything.

## Spikes first

Each one is written into this plan before the code that depends on it.

- **S1, first deploy.** Deploy `main` as it is, with production behind Vercel Authentication so nobody else can open it. Record:
  - whether the npm workspace installs and builds on Vercel as it is (the web workspace depends on DuckDB's native package, which the site doesn't need at run time), and the build time
  - the size of a results page as HTML and as a client-side navigation, and of a download with every record, to estimate how far the 10 GB of fast origin transfer goes
  - the server response time for spec 002's fixed searches, from the owner's laptop, for AC12
  - whether Hobby can roll back to the previous production deployment (unverified)

  Results, 2026-10-18, from a deployment of `main` at `491af4c` with Node 22.x selected and production behind Vercel Authentication:
  - **Install and build:** the workspace installs and builds as it is, so `web/vercel.json` needs no install command. The install added 278 packages in 15 s, Next.js 16.4 compiled in 9.6 s, and the build took 30 s, or 34 s from clone to deployed. The log has no warnings and doesn't name the Node version. Building and uploading the 293 MB build cache took another 25 s after the deployment was live.
  - **Region:** the Railway server is in US East (Virginia). Vercel's nearest region is Washington, D.C. (`iad1`), which is also its default, and `web/vercel.json` records it.
  - **Rollback:** Vercel's docs (checked 2026-10-18) say Hobby can roll back to the immediately previous production deployment only, and that after a rollback, pushes to `main` don't go live until the rollback is undone from the production deployment's tile. Task 15 tries it.
  - **How sizes and times were measured:** past Vercel Authentication, a script sent a Protection Bypass for Automation secret in the `x-vercel-protection-bypass` header. It's available on Hobby (Vercel docs, checked 2026-10-18). The secret lives in the owner's `.env.hosted`, and the owner revokes it once S1 is recorded. The site served the hosted snapshot of 16 October 2026 (`5338abda`), with 73,283 records.
  - **Sizes,** on the wire with Brotli and unpacked: a results page is 32–36 KB and 327–450 KB as HTML, and 21 KB and 143–163 KB as a client-side navigation (the full tree, so an upper bound). A record page is 8 KB and 45 KB. The download with every record is 13.6 MB and 67.8 MB, and took 5.1 s. The HTML is about nine times decision record 005's guess of 50 KB, since it carries 50 results, the filter counts, and the same content again as Next.js's data for the browser.
  - **The 10 GB of fast origin transfer:** Vercel's docs (checked 2026-10-18) count the bytes between its CDN and the functions, but don't say whether they're compressed. Unpacked, the allowance covers about 23,000 results pages, 65,000 client-side navigations or 150 full downloads a month; compressed, about 290,000 pages or 750 full downloads. Downloads are the risk: one script fetching the full file 150 times could use up the month. Decision record 005 accepts that risk until the announcement.
  - **Response times,** from the owner's laptop on 2026-10-18, 10 runs of each of spec 002's 14 searches after one warm-up: median 336 ms, 95th percentile 455 ms, under AC12's proposed 500 ms. The slowest single searches were `in_title=brain tumor` with China excluded (p95 901 ms) and `q=neuron` (p95 645 ms). Requests entered at Vercel's San Francisco edge (`sfo1`), about 49 ms from the laptop for a static file, and ran in `iad1`, so a visitor on the East Coast would see less. AC12's Lighthouse budget is measured in task 14.
- **S2, a busy minute.** Count the requests that reach Vercel in the most intense minute of browsing the e2e tests can produce, such as paging through results while record links prefetch. The firewall limit goes well above that.

  Results, 2026-10-18, from a Playwright script that browsed a local production build of `main` at `842aece` in Chrome, with the site's own limits off, counting every request the firewall rule would see (all but `/_next/static/`):
  - **One round of browsing:** open the start page, scroll to the end of the results and go to the next page three times, open three records and come back each time, add a filter, type a search, type in the journal value search, and open a record. Each scroll reaches the end of the 50 results in about two seconds.
  - **At a fast human pace,** one second after each step and 120 ms per key: 367 requests in two minutes, at most 217 in any 60 seconds and 49 in any 10 seconds.
  - **As fast as the browser goes,** with no pauses: at most 1,382 in any 60 seconds and 237 in any 10 seconds. No person browses this fast.
  - **Prefetches are most of it:** 301 of the 367 requests at the human pace, and 1,687 of 2,026 at full speed. Each record link in the results prefetches `/record/<id>` as it scrolls into view, so a results page read to the end sends about 50. For a server-rendered page with no loading state, the prefetch answer is 299 bytes and holds only the route tree, not the record, so opening the record still makes its own request.
  - **Allowances:** every prefetch is also a CDN request and a request the firewall rule allows, and probably a function invocation (unverified). Hobby includes 1,000,000 of each a month (decision record 005), so with prefetches a results page read to the end uses about 50 of each.
  - **With record prefetches off** (see "Limits"), the same script on a new build sent no prefetches. At the fast human pace: 66 requests in two minutes, at most 37 in any 60 seconds and 11 in any 10 seconds. As fast as the browser goes: at most 230 in any 60 seconds and 42 in any 10 seconds. About half of what's left is `/icon.svg`, which the browser checks again after most navigations.
  - **The rule:** a fixed 60-second window and 300 requests per IP address, on every path that doesn't start with `/_next/static/`, answering 429 over the limit. That's about eight times the fast human minute, which leaves room for several people behind one address, such as a university network, and for `check:speed -- --url` (about 150 requests over a couple of minutes). The owner published it on 2026-10-19.

## Build and deploy (AC1, AC2)

- Vercel installs from the repository root, which holds the lockfile and the workspace list. If spike S1 finds the full install slow or broken, `web/vercel.json` sets an install command limited to the web workspace.
- The build runs `web`'s `npm run build`, which starts Next.js through `scripts/next.mjs`. That script loads `.env.local` only if it exists, so on Vercel the variables come from the project settings.
- `web/vercel.json` also sets `regions` to the region chosen in setup, so the choice is in the repository rather than only in the dashboard.
- For a monorepo on GitHub, Vercel skips the build when a commit doesn't touch the project or its dependencies (Vercel monorepo docs, checked 2026-10-15). Pipeline-only commits then don't redeploy the site.
- Preview deployments get the same variables as production. The key can only search and export.

## The site's key (AC4)

`npm run load` already creates or reuses the site's key and writes it to `.env.local`. That code moves into its own function, which a new command calls:

- `npm run site-key -- --server-env <file>` finds a key on that server with the site key's description, actions and collections. If the key in the file is one of them, it keeps it. Otherwise it creates one and writes `TYPESENSE_SEARCH_KEY` into the file. It prints whether it created or reused the key and the key's id, never the key.
- `npm run load` calls the same function, so nothing changes locally.
- The owner pastes the value into Vercel's settings. The daily update still never touches keys.

## Limits (AC6, AC7)

- **Firewall rule.** Hobby allows one rate-limit rule, counted by IP address, with a fixed window of 10 seconds to 10 minutes (Vercel WAF docs, checked 2026-10-15). Vercel sets the address itself and ignores a client's `X-Forwarded-For`. Over the limit, Vercel answers with its own 429 page. The window and limit come from spike S2, and the runbook records them. Vercel checks deployment protection before the project's firewall rules (Vercel Firewall concepts, checked 2026-10-19), so the rule never sees a request that Vercel Authentication turns away, and the check that it answers 429 waits until production is open. Vercel's platform protection also acts without any rule: on 2026-10-19, a burst of about 100 requests a second from one address met its "Security Checkpoint" challenge (HTTP 403) after 130 requests, before the rule's limit, and the address stayed challenged for about 10 minutes. At a steady 8 requests a second, the rule answered 429 after 296.
- **Record links don't prefetch** (spike S2; owner, 2026-10-18). Each record link in the results prefetched its record page as it scrolled into view, so a results page read to the end sent about 50 requests, each counted by the firewall rule. The prefetch held only the route tree, so turning it off, as the filter, page and search links already do, costs nothing when a record opens. A Playwright test scrolls through the results and checks that nothing is prefetched.
- **The site's own limits off.** With `RATE_LIMITS=off`, the rate-limit check allows every request without touching Redis, and logs "Rate limits are off (RATE_LIMITS=off)" once per server start. Today a missing `REDIS_URL` already lets requests through, but logs an error up to once a minute, which would clutter the live site's logs. `REDIS_URL` and `VISITOR_HASH_SALT` aren't needed when the limits are off.
- **Locally** nothing changes: `.env.local` has no `RATE_LIMITS`, so the limits stay on, and the e2e limit and Redis-failure tests keep running.
- **Downloads** get no limit of their own until the rate-limit iteration, since the one rule covers every path. Spike S1 measures how much of Vercel's allowance a download uses.

## Indexing switch (AC10)

- `app/robots.ts` returns `Disallow: /` unless `SITE_INDEXING` is `on`.
- The root layout's metadata sets `robots: { index: false, follow: false }` unless `SITE_INDEXING` is `on`.
- Vercel applies a changed variable on the next deployment, so turning indexing on is: set the variable, then redeploy from the dashboard. The runbook says so.
- What stays out of search engines after launch is an open question in the spec. If the owner chooses to keep record and results pages out, the same switch covers them.

## Monitoring (AC9)

- **Health route.** `GET /api/health` runs the default view's count through the site's own search code and returns `{ ok, dataDate, total }`, with `Cache-Control: no-store`, or HTTP 503 when Typesense can't be reached. It skips rate limits, so it keeps working once the site's own limits return. Everything it returns is already in the site's footer.
- **Workflow.** `.github/workflows/site-check.yml` runs at 02:47, 08:47, 14:47 and 20:47 UTC and by hand, in the `site` environment. The first two come about 90 minutes after the daily update's runs at 01:17 and 07:17, so a site an update broke is caught soon after. Every 6 hours rather than every hour keeps an outage to four alert comments a day, and the checks' start-page loads to about 45 MB of fast origin transfer a month (owner, 2026-10-18). A script in `pipeline/src/` loads `/` and `/api/health` and checks for HTTP 200, `ok`, and a total above zero.
- **Alerts.** `alert.js` from spec 003 takes the label and title as options. The check uses the label `site-check`, with "Site check failed" as the title. The comment gives the failed step, the status and the time, but not the address. GitHub masks the `SITE_URL` secret in logs.
- **Keeping it alive.** GitHub disables scheduled workflows after 60 days without repository activity. `keepalive.js` already re-enables `update.yml` after each successful run. It re-enables `site-check.yml` as well.

## Checks on the live site (AC11, AC12)

- **Counts:** `npm run check:search` runs the site's own server code against the server in `.env.local`. It gains `--server-env <file>`, so the same checks run against the hosted server and its snapshot. A spot check then compares the live site's default total with the check's.
- **Accessibility:** a Playwright project, `live`, runs only the axe tests, against `SITE_URL`. The limit and failure tests stay local, since they need lowered limits and stopped services.
- **Speed:** `npm run check:speed -- --url <address>` skips the local build and times the live site from the laptop, then runs Lighthouse's mobile test on a shared URL.

## Tests

| What | How | ACs |
|---|---|---|
| Site key reuse and creation, and that it never prints the key | Unit, with a fake Typesense | AC4 |
| `RATE_LIMITS=off` allows every request, never opens a Redis connection and logs once | Unit | AC7 |
| Robots and metadata with and without `SITE_INDEXING` | Unit | AC10 |
| Health route: data date and total, and 503 when Typesense can't be reached | Unit | AC9 |
| Site check and alert labels | Unit, like spec 003's alert tests | AC9 |
| Noindex by default | Playwright, locally | AC10 |

Manual checks, recorded in the runbook with their dates: preview protection (AC2), a search for the key in the page source, build log and repository (AC5), the firewall rule answering 429 past its limit (AC6), the payment settings of each provider (AC8), and one forced failure of the site check, by pointing it at a missing path for a run (AC9).

## Order of work

Three pull requests, as in spec 003:

1. **Local code:** site-key command, `RATE_LIMITS=off`, indexing switch, health route, site-check workflow, and their tests. Spike S1 can run alongside, since it deploys `main` as it is behind Vercel Authentication.
2. **Live:** the owner's setup, spike S2, the firewall rule, then production protection off with indexing still off. Then the live checks (AC11, AC12) and the runbook's site section (AC13).
3. **Close-out,** once daily updates load again: the week of updates, the name and domain, indexing on, and the announcement.

## Trade-offs

1. **The firewall rule instead of the site's own limits.** No Redis, account or code, but visitors over the limit get Vercel's plain 429 page instead of spec 002's notice, and downloads share the general limit.
2. **No analytics until a later iteration.** The site goes live sooner and with fewer moving parts, but nothing records visits, downloads or the brief's metrics until then.
3. **Previews share production's search server.** They're behind Vercel Authentication and use a search-only key, so a second server isn't worth its setup.

## Changes to other documents

Made with this draft:

- **Product brief:** the website row of "How it runs", the roadmap's Phase 4 and the later iterations, the success metrics' note on when recording starts, and the analytics open question.
- **`CLAUDE.md`:** the "Keys stay on the server" constraint says each visitor's requests are rate-limited, which the firewall rule does in the first release.
- **Plan 002:** the production store and visitor address notes point to decision record 005.

Made with the code:

- **`CLAUDE.md`:** the stack adds Vercel, and the commands table adds `site-key` and the new options.
- **`.env.example`:** the `RATE_LIMITS` and `SITE_INDEXING` settings.
- **Plan 002:** the rate-limit note on prefetches says the results' record links no longer prefetch.
- **Runbook:** spec 003's task 17 writes it. This spec adds the site section afterwards (AC13).

## Still open

- The open questions in the spec: name and domain, announcing before analytics, what search engines may index, a notice when data is behind, and upstream's export. The owner confirmed the budgets in AC12 on 2026-10-19.
- How many rate-limit rules Hobby allows. Vercel's docs say one (checked 2026-10-15 and 2026-10-19), but on 2026-10-19 the dashboard's menu for a new rule showed "Rate Limit 0 / 3". If Hobby allows more, a separate, lower limit for downloads is worth proposing.
