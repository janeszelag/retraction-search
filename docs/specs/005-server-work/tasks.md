# Tasks 005: Less server work per page

Status: draft for the owner's review, 2026-11-02. No task has started. Follows [plan 005](plan.md). Work one task at a time, and tick a task off once its "done when" check passes. If a spike or task shows the spec can't be met as written, stop and propose a spec change first.

The work goes up in two pull requests:

1. **Tasks 2–8** add caching and the failed pages. They need no new account. Task 2 ships alone, as the smallest test of the idea.
2. **Tasks 10–15** add the ceilings and alerts, once the owner has created the store (task 9).

Task 1 goes first, today. Tasks 9 and 17 are the owner's.

**The owner's firewall steps**

- [ ] **1. Firewall, today (AC16, AC17).** The owner edits the rule that logs `/api/export` so it denies requests with no `sec-fetch-site` header, and sets Bot Protection to Log.
  - Done when: `curl` gets 403 from `/api/export`, Download CSV works in Chrome, Firefox and Safari, and the result is recorded here with its date.

**First pull request: caching**

- [ ] **2. Spike S1 (AC1).** Send the CDN header on `/about` only, in `next.config.ts`, with no setting yet.
  - Done when: the second of two `curl` requests to the live `/about` shows `x-vercel-cache: HIT`, and the result is recorded in the plan. If it can't be made to work, stop and revise the plan.
- [ ] **3. Failed pages (AC3, AC4, AC9).** The search and record pages throw when the search can't run. Add `app/error.tsx`, with the message, a retry link and the attribution, using `<Unavailable>`'s content.
  - Done when: end-to-end tests with the search server down show HTTP 500, the message and the attribution, for a full page and for an in-app request. Spec 002's other tests pass. The owner has accepted open question 1, and spec 002 AC29 is changed to match.
- [ ] **4. The setting (AC6).** Replace task 2's header with `PAGE_CACHE_SECONDS` in `next.config.ts`, covering the start, record and About pages for full-page requests only. The build refuses the setting while `RATE_LIMITS` isn't `off`.
  - Done when: unit tests cover the setting on and off and the refusal, and a local run shows the header on a page and not on a request with `rsc`.
- [ ] **5. Nothing personal in a shared page (AC5).** Check the rendered pages for anything that varies by visitor.
  - Done when: an end-to-end test loads the same address with two different sets of request headers and compares the HTML, apart from the data Next.js generates per build.
- [ ] **6. Speed check.** `check:speed -- --url` adds an unused query parameter, so it keeps timing the server rather than the CDN.
  - Done when: its unit test passes, and a run against the live site shows `x-vercel-cache: MISS`.
- [ ] **7. Documents.** The runbook covers the setting, how to turn caching off, and what a stale page means. Spec 004 AC9 and AC14 and plan 004's "50 results" are updated.
  - Done when: the owner has read them.
- [ ] **8. Live checks (AC1, AC2, AC3).** The owner sets `PAGE_CACHE_SECONDS=3600`, and the first pull request ships.
  - Done when: repeat requests show `HIT`, `/api/health` and in-app requests never do, a new snapshot's date appears within 2 hours, and spike S2 has run, or is scheduled for the next planned restart. All recorded in the plan.

**The store**

- [ ] **9. Store (AC13).** The owner accepts decision record 006, creates the database with no card, and adds `REDIS_URL` to Vercel for Production.
  - Done when: the record's status says accepted, with the date.

**Second pull request: ceilings**

- [ ] **10. The rules (AC7, AC10, AC12, AC13).** Add `web/lib/ceiling.ts` and its tests: windows, whether a count passes, and the settings.
  - Done when: unit tests pass, including one that computes the month's commands at the default ceilings and fails above 500,000.
- [ ] **11. The count (AC7, AC11, AC12).** Add `add` to `CounterStore`, and `checkCeiling` in `web/lib/server/ceiling.ts`, sharing the Redis client with the existing limits.
  - Done when: unit tests with a fake store show one `INCRBY` a page, `EXPIRE` only on a new key, no store call after a ceiling is reached, and a failing store treated as no ceiling, with one log line a minute.
- [ ] **12. Pages (AC7, AC9).** The search and record pages check the ceiling before searching, and throw past it. The About page doesn't.
  - Done when: an end-to-end test with a low ceiling shows the refused page, with no search reaching Typesense, and the About page still answering.
- [ ] **13. Downloads (AC8).** `/api/export` checks the ceiling with the record count, and answers 429 with `Retry-After`. The button shows its own wording.
  - Done when: unit and end-to-end tests cover a download that fits, one that doesn't, and a small one after a refused large one. Spec 002's download limit keeps working locally.
- [ ] **14. Alerts (AC14, AC15).** `/api/health` reports the ceilings and the store, reading the store at most once a minute. `site-check.js` fails on either, and says which.
  - Done when: unit tests cover both, and a burst of health requests makes at most one store call a minute.
- [ ] **15. Documents.** The runbook covers the store, the ceilings and what to do when one is reached, including Attack Mode. Spec 004 AC7, decision record 005, `CLAUDE.md` and the brief's roadmap are updated.
  - Done when: the owner has read them.

**Closing**

- [ ] **16. Simulated crawl and speed (AC18, S3).** The owner sets `CEILING_PAGES` and `CEILING_RECORDS`, and the second pull request ships. With a low ceiling on the local stack, a script requests new addresses until it's refused. Then `check:speed` runs against the live site.
  - Done when: the crawl stops at the ceiling, the site check fails with the right message, cached pages keep answering, and the live 95th percentile stays under 500 ms. All recorded in the plan.
- [ ] **17. A week of Usage (AC17, AC19).** The owner records daily Active CPU, origin transfer, invocations, CDN requests and Provisioned Memory after each pull request, next to the estimate, and reads Bot Protection's log.
  - Done when: the table is in the plan, the daily rate fits the 30-day allowances, the ceiling is reset to its long-term value after about November 27, and the last custom rule is decided.
