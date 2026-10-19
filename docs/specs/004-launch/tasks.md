# Tasks 004: Launch

Status: in progress, 2026-10-18. Follows [plan 004](plan.md). Work one task at a time, and tick a task off once its "done when" check passes. If a spike or task shows the spec can't be met as written, stop and propose a spec change first.

The work goes up in three pull requests:

1. **Tasks 1–8** are code and checks that run on the laptop, plus spike S1, which deploys behind Vercel Authentication.
2. **Tasks 9–15** take the site live. Production deploys from `main`, and the `site` environment only allows `main`, so they start once the first pull request has merged.
3. **Tasks 16–19** close the spec, once daily updates load again. Task 20 follows a month after the announcement.

**Before code**

- [x] **1. Site-key command.** Move the site key's reuse and creation out of `load.js` into its own function. Add `npm run site-key -- --server-env <file>`, which writes `TYPESENSE_SEARCH_KEY` into that file and prints only whether it created or reused the key, and the key's id. `npm run load` calls the same function. Add the command to `CLAUDE.md`. (AC4)
  - Done when: unit tests with a fake Typesense cover reuse, creation and a key in the file that the server no longer has, and show the key never reaches the output. `npm run load` behaves as before. The owner runs the command against `.env.hosted`, and the file gains the key.
  - Result, 2026-10-18: six unit tests in `pipeline/test/site-key.test.js` cover creation, reuse, a key the server no longer has, a key with other actions, and the deletion of older site keys, and check that no log line contains the key. `npm run load` on the local stack reused the local key and left `.env.local` unchanged. The owner's run against `.env.hosted` created the hosted server's first site key (id 0) and wrote it to the file. Like `npm run load`, the command deletes older keys it made, so changing the hosted key takes the site's search down until Vercel has the new key; the runbook (task 15) gives the order.

- [x] **2. Spike S1, first deploy.** The owner's steps first: note the Railway server's region, sign up for Vercel on Hobby with no payment method, import the repository with `web` as the root directory, set Node 22 and the function region nearest Railway, turn on Vercel Authentication for production as well as previews, and add `TYPESENSE_URL` and `TYPESENSE_SEARCH_KEY` (sensitive). Then deploy `main` and record what the plan lists: the install and build, page and download sizes, the server response times for spec 002's fixed searches, and whether Hobby can roll back. Add `web/vercel.json` with the region, and an install command if the build needs one. (AC1, AC12)
  - Done when: the results are in the plan's spike list, with an estimate of how many pages and full downloads the 10 GB of fast origin transfer allows. If the build failed as it was, the fix is in this pull request and a second deploy succeeded.
  - Result, 2026-10-18: the workspace installed and built on Vercel as it is, so `web/vercel.json` only sets the region (`iad1`, nearest the Railway server in US East). The import deployed at once with the production domain public, so the owner imported without variables and then set Vercel Authentication for All Deployments. Spec 002's searches gave a 95th percentile of 455 ms from the owner's laptop. The 10 GB allows roughly 23,000 to 290,000 results pages, or 150 to 750 full downloads, a month. Hobby rolls back to the previous production deployment only. Details are in the plan's spike list.

**Site changes**

- [ ] **3. Limits off by setting.** With `RATE_LIMITS=off`, the rate-limit check allows every request, opens no Redis connection and logs "Rate limits are off (RATE_LIMITS=off)" once per server start. Document the setting in `.env.example`. (AC7)
  - Done when: unit tests cover the setting on and unset. `npm test` and `npm run test:e2e` pass unchanged, with the limit and Redis-failure tests still running locally.

- [ ] **4. Indexing switch.** `app/robots.ts` disallows everything, and the root layout's metadata sets `noindex, nofollow`, unless `SITE_INDEXING` is `on`. Document the setting in `.env.example`. (AC10)
  - Done when: unit tests cover both values, and a Playwright test shows `robots.txt` disallowing everything and a page carrying `noindex` by default.

- [ ] **5. Health route.** `GET /api/health` returns `{ ok, dataDate, total }` for the default view, with `Cache-Control: no-store`, or HTTP 503 when Typesense can't be reached. It skips rate limits. (AC9)
  - Done when: unit tests cover both answers, and the route returns the local snapshot's data date and default total under `npm run web`.

- [ ] **6. Site check workflow.** `pipeline/src/site-check.js` loads `/` and `/api/health` from `SITE_URL` and checks for HTTP 200, `ok` and a total above zero. `alert.js` takes the label and title as options. `.github/workflows/site-check.yml` runs at minute 47 of every hour and by hand, in the `site` environment, with `issues: write`, GitHub's own actions pinned to commit SHAs, and failures reported under the `site-check` label without the address. `keepalive.js` also re-enables `site-check.yml`. (AC9)
  - Done when: unit tests cover the check's failures and the alert labels, and spec 003's alert and keepalive tests still pass. The live run is task 12.

- [ ] **7. Options for the live checks.** `npm run check:search` takes `--server-env <file>`. A Playwright project, `live`, runs only the axe tests against `SITE_URL`. `npm run check:speed` takes `--url <address>` and then skips the local build. Add the options to `CLAUDE.md`. (AC11, AC12)
  - Done when: `check:search` with `--server-env .env.local` gives the same results as without it, and the `live` project and `check:speed --url` pass against `npm run web` on the laptop.

- [ ] **8. Stack in `CLAUDE.md`.** The stack names Vercel Hobby and decision record 005. (Plan, changes to other documents)
  - Done when: `CLAUDE.md` matches what tasks 1–7 built. The first pull request goes up.

**Going live**

- [ ] **9. Production settings.** The owner adds `RATE_LIMITS=off` to Production and Preview, gives Preview the same Typesense variables, and creates the GitHub `site` environment, limited to `main`, with the secret `SITE_URL`. (AC1, AC2, AC5)
  - Done when: the merge of the first pull request deploys production. A preview of a test pull request asks for a Vercel login in a private window. A search of the page source, the build log and the repository finds no part of the search key.

- [ ] **10. Spike S2 and the firewall rule.** Count the requests in the busiest minute of the e2e tests, then the owner adds the rate-limit rule by IP address on every path except `/_next/static/`. Write the count, the window and the limit into the plan. (AC6)
  - Done when: a short burst from the laptop, past the limit, gets HTTP 429, and the owner browses quickly through results and records without meeting it.

- [ ] **11. Cost check.** The owner confirms Railway's $50 hard limit and $10 alert, and that the Vercel account has no payment method. (AC8)
  - Done when: the check and its date are recorded under this task, and move into the runbook with task 15.

- [ ] **12. Live site check.** Start `site-check.yml` by hand, then once with `SITE_URL` pointing at a missing path, then again with the right address. (AC9)
  - Done when: the first run passes, the second opens a `site-check` issue with the step, the status and the time, and the third closes it. Neither the logs nor the issue show the address.

- [ ] **13. Open production.** The owner turns Vercel Authentication off for production, with `SITE_INDEXING` still unset. (AC1, AC3, AC10)
  - Done when: in a private window the site searches the hosted server, and its footer shows the hosted snapshot's data date and commit. `robots.txt` disallows everything, and pages carry `noindex`.

- [ ] **14. Live checks.** Run `check:search -- --server-env .env.hosted`, compare the live site's default total with it, run the `live` Playwright project, and run `check:speed -- --url` against the live site. (AC11, AC12)
  - Done when: the counts match, axe finds no violations on the five pages, and the owner confirms AC12's budgets from the measured numbers, or a spec change is proposed.

- [ ] **15. Runbook: the site.** After spec 003's task 17 writes `docs/runbook.md`, add the site section the plan lists: deploying and rolling back, changing the search key and the firewall rule, turning on indexing, each provider's limits, and the dated checks from tasks 9–14. (AC13)
  - Done when: the owner follows it to roll production back to the previous deployment and forward again. The second pull request goes up.

**Close-out**

- [ ] **16. A week of updates.** Once upstream's export loads again, the daily update keeps the hosted data current for seven consecutive days while the live site serves it. Spec 003's unattended week (its task 20) can be the same week. (Done when)
  - Done when: each day's hosted data date is recorded, from the live site's footer.

- [ ] **17. Name and domain.** The owner chooses the site's name, and whether to buy a domain or keep the `vercel.app` address. (Open question)
  - Done when: the site answers at the chosen address over HTTPS, and decision record 005 records the domain's yearly price or the choice to keep the `vercel.app` address.

- [ ] **18. Questions before the announcement.** The owner decides the spec's remaining open questions: announcing before the analytics iteration, what search engines may index, and a notice when data is behind. (Open questions)
  - Done when: each answer is recorded in the spec. An answer that needs new work becomes a spec change or a later iteration before the announcement.

- [ ] **19. Launch.** Set `SITE_INDEXING=on`, redeploy, and announce the site. (AC10, done when)
  - Done when: `robots.txt` and the pages allow indexing as task 18 decided, and the brief's roadmap marks Phase 4 done. The closing pull request goes up.

- [ ] **20. First month.** A month after the announcement, compare Vercel's allowances and Railway's egress with decision record 005's estimates. (Success metrics)
  - Done when: decision record 005 has the measured numbers, in a small pull request of its own.
