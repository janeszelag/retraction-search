# Tasks 005: Less server work per page

Status: draft for the owner's review, 2026-11-02. Task 1 is done, and no other task has started. Follows [plan 005](plan.md). Work one task at a time, and tick a task off once its "done when" check passes. If a spike or task shows the spec can't be met as written, stop and propose a spec change first.

The work goes up in two pull requests:

1. **Tasks 4–10** add caching and the failed pages. They need no new account. Task 4 ships alone, as the smallest test of the idea.
2. **Tasks 12–17** add the ceilings and alerts, once the owner has created the store (task 11).

Tasks 1–3, 11 and 19 are the owner's.

**The owner's firewall steps**

- [x] **1. Bot Protection (AC17).** The owner sets it to Challenge.
  - Result, 2026-11-02: the site kept working. `curl`, `curl` with Chrome's user agent and Node's `fetch` each got 429 with `x-vercel-mitigated: challenge` from `/api/export`, and Node's `fetch` got the same from `/api/health`.
- [ ] **2. The site check gets through (AC17).** The owner's separate pull request: a bypass rule and a secret header. It covers `/` and `/api/health`, and not `/api/export`. Covering every page except `/api/export` would also serve this plan's live checks.
  - Done when: the scheduled site check passes on the live site.
- [ ] **3. Download rule (AC16).** The owner edits the rule that logs `/api/export` so it denies requests with no `sec-fetch-site` header.
  - Done when: `curl` gets 403 with `x-vercel-mitigated: deny` from `/api/export`, Download CSV works in Chrome, Firefox and Safari, and the result is recorded here with its date.

**First pull request: caching**

- [ ] **4. Spike S1 (AC1).** Send the CDN header on `/about` only, in `next.config.ts`, with no setting yet.
  - Done when: the second of two requests to the live `/about`, from a browser or with the site check's header, shows `x-vercel-cache: HIT`, and the result is recorded in the plan. If it can't be made to work, stop and revise the plan.
- [ ] **5. Failed pages (AC3, AC4, AC9).** The search and record pages throw when the search can't run. Add `app/error.tsx`, with the message, a retry link and the attribution, using `<Unavailable>`'s content.
  - Done when: end-to-end tests with the search server down show HTTP 500, the message and the attribution, for a full page and for an in-app request. Spec 002's other tests pass. The owner has accepted open question 1, and spec 002 AC29 is changed to match.
- [ ] **6. The setting (AC6).** Replace task 4's header with `PAGE_CACHE_SECONDS` in `next.config.ts`, covering the start, record and About pages for full-page requests only. The build refuses the setting while `RATE_LIMITS` isn't `off`.
  - Done when: unit tests cover the setting on and off and the refusal, and a local run shows the header on a page and not on a request with `rsc`.
- [ ] **7. Nothing personal in a shared page (AC5).** Check the rendered pages for anything that varies by visitor.
  - Done when: an end-to-end test loads the same address with two different sets of request headers and compares the HTML, apart from the data Next.js generates per build.
- [ ] **8. Speed check.** `check:speed -- --url` adds an unused query parameter, so it keeps timing the server rather than the CDN, and sends the site check's header, so Bot Protection lets it through.
  - Done when: its unit test passes, and a run against the live site shows `x-vercel-cache: MISS`. Needs task 2.
- [ ] **9. Documents.** The runbook covers Bot Protection's setting, the caching setting, how to turn caching off, and what a stale page means. Spec 004 AC9 and AC14 and plan 004's "50 results" are updated.
  - Done when: the owner has read them.
- [ ] **10. Live checks (AC1, AC2, AC3).** The owner sets `PAGE_CACHE_SECONDS=3600`, and the first pull request ships.
  - Done when: repeat requests show `HIT`, `/api/health` and in-app requests never do, a new snapshot's date appears within 2 hours, and spike S2 has run, or is scheduled for the next planned restart. All recorded in the plan.

**The store**

- [ ] **11. Store (AC13).** After a week of Usage with Bot Protection on Challenge, the owner accepts decision record 006, creates the database with no card, and adds `REDIS_URL` to Vercel for Production.
  - Done when: the record's status says accepted, with the date.

**Second pull request: ceilings**

- [ ] **12. The rules (AC7, AC10, AC12, AC13).** Add `web/lib/ceiling.ts` and its tests: windows, whether a count passes, and the settings.
  - Done when: unit tests pass, including one that computes the month's commands at the default ceilings and fails above 500,000.
- [ ] **13. The count (AC7, AC11, AC12).** Add `add` to `CounterStore`, and `checkCeiling` in `web/lib/server/ceiling.ts`, sharing the Redis client with the existing limits.
  - Done when: unit tests with a fake store show one `INCRBY` a page, `EXPIRE` only on a new key, no store call after a ceiling is reached, and a failing store treated as no ceiling, with one log line a minute.
- [ ] **14. Pages (AC7, AC9).** The search and record pages check the ceiling before searching, and throw past it. The About page doesn't.
  - Done when: an end-to-end test with a low ceiling shows the refused page, with no search reaching Typesense, and the About page still answering.
- [ ] **15. Downloads (AC8).** `/api/export` checks the ceiling with the record count, and answers 429 with `Retry-After`. The button shows its own wording.
  - Done when: unit and end-to-end tests cover a download that fits, one that doesn't, and a small one after a refused large one. Spec 002's download limit keeps working locally.
- [ ] **16. Alerts (AC14, AC15).** `/api/health` reports the ceilings and the store, reading the store at most once a minute. `site-check.js` fails on either, and says which.
  - Done when: unit tests cover both, and a burst of health requests makes at most one store call a minute.
- [ ] **17. Documents.** The runbook covers the store, the ceilings and what to do when one is reached, including Attack Mode and what to do about a verified bot. Spec 004 AC7, decision record 005, `CLAUDE.md` and the brief's roadmap are updated.
  - Done when: the owner has read them.

**Closing**

- [ ] **18. Simulated crawl and speed (AC18, S3).** The owner sets `CEILING_PAGES` and `CEILING_RECORDS`, and the second pull request ships. With a low ceiling on the local stack, a script requests new addresses until it's refused. Then `check:speed` runs against the live site.
  - Done when: the crawl stops at the ceiling, the site check fails with the right message, cached pages keep answering, and the live 95th percentile stays under 500 ms. All recorded in the plan.
- [ ] **19. A week of Usage (AC17, AC19).** The owner records daily Active CPU, origin transfer, invocations, CDN requests and Provisioned Memory after each pull request, next to the estimate, and reviews what Bot Protection challenged.
  - Done when: the table is in the plan, the daily rate fits the 30-day allowances, the ceiling is reset to its long-term value after about November 27, and people using browsers aren't being stopped.
