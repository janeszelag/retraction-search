# Runbook

How the hosted pieces run, what to do when one fails, and how to make the routine changes. Written for someone who hasn't run a server before. Spec 003 (AC21) asked for the search server and the daily update; spec 004 (AC13) added the website.

Facts about providers carry the date they were checked. Prices and limits change, so check the provider's page again before relying on one.

## What runs where

| Piece | Where | What it does |
|---|---|---|
| Search server | Typesense 30.2 on Railway, Hobby plan | Holds the search index on a volume at `/data`, reached over HTTPS |
| Daily update | GitHub Actions, `.github/workflows/update.yml` | Loads each new upstream snapshot into the search server, scheduled for 01:17 and 07:17 UTC |
| Website | Vercel, Hobby plan, deployed from `main` | Serves the pages. Its server code runs in Washington, D.C. (`iad1`), next to the search server, and is the only thing the site uses to search |
| Firewall rule | Vercel, the project's Firewall | Limits each IP address to 300 requests a minute |
| Site check | GitHub Actions, `.github/workflows/site-check.yml` | Loads the live site every 6 hours, scheduled for 02:47, 08:47, 14:47 and 20:47 UTC |
| Tests | GitHub Actions, `.github/workflows/test.yml` | Runs `npm test` on every pull request and push to `main` |

Every failure that matters opens or updates a GitHub issue, labeled by what failed:

| Label | Opened by | Closed by |
|---|---|---|
| `daily-update` | A failed or cancelled daily update | The next successful update |
| `site-check` | A failed site check | The next site check that passes |
| `schedule-keepalive` | A daily update when `main` has had no commit for 45 days | A daily update after the next commit |

GitHub also emails the owner when a workflow fails, if email for failed workflows is on (GitHub settings, Notifications, Actions). For scheduled workflows, GitHub only emails the person who last changed the schedule in the workflow file.

## Keys and settings

The search server has two keys. Neither is ever printed by the commands here, and neither belongs in the repository.

| Key | What it can do | Where it lives |
|---|---|---|
| Admin key | Everything: create, change and delete collections and keys | Railway's `TYPESENSE_API_KEY` variable, the GitHub `search` environment's secret `TYPESENSE_ADMIN_KEY`, and `.env.hosted` on the laptop |
| Site key | Search and export, on the `retractions` alias and the `meta` collection only | Vercel's `TYPESENSE_SEARCH_KEY` variable (marked sensitive), and `.env.hosted` |

Other settings:

| Setting | Where | Value |
|---|---|---|
| `TYPESENSE_URL` | GitHub `search` secret, Vercel (Production and Preview), `.env.hosted` | The search server's HTTPS address |
| `RATE_LIMITS` | Vercel (Production and Preview) | `off`: the site's own per-visitor limits stay off while the firewall rule does the job |
| `SITE_INDEXING` | Vercel (Production) | Unset until launch, so `robots.txt` and every page ask search engines to stay away |
| `SITE_URL` | GitHub `site` environment, as a secret | The live site's address. A secret, not a variable: the workflow reads only secrets, and GitHub masks secrets in logs |

The `search` and `site` environments only let workflows on `main` read their secrets.

`.env.hosted` is the laptop's copy of the hosted settings. `.gitignore` excludes every `.env.*` file except `.env.example`. Commands take it with `--server-env .env.hosted`.

## The daily update

Upstream (Crossref's copy of the Retraction Watch database, https://gitlab.com/crossref/retraction-watch-data) commits a new `retraction_watch.csv` at about 23:00 UTC on working days. The update is scheduled for 01:17 UTC, and again for 07:17 UTC in case the first run was delayed, dropped or failed. GitHub starts scheduled runs hours late: from 2026-10-17 to 2026-10-26, the 01:17 run started between 05:33 and 06:09 UTC, and the 07:17 run between 11:36 and 14:40. Site checks from 2026-10-23 to 2026-10-27 started 2 to 7 hours after their times. On most days the second run finds nothing new and ends within a minute.

Each run, in order:

1. Reads which upstream commit the search server has loaded, from its `meta` document.
2. Asks GitLab for the newest commit. If it's more than three working days old (Monday to Friday, in UTC), the run fails: the file may have moved or stopped updating. If the server already has it, the run says "up to date" and stops.
3. Downloads the new snapshot, and the loaded one again for comparison.
4. Cleans the new snapshot, as `npm run clean` does.
5. Compares the two snapshots record by record: the diff.
6. Stops if the changes look like a broken file rather than an update (the change limits, below).
7. Imports the snapshot into a new collection, then checks that every stored record matches the cleaned file. A mismatch gets one more import (decision record 004).
8. Points the `retractions` alias, which the site searches, at the new collection. Then it checks counts through the alias against DuckDB. If a check fails, the alias goes back and search stays on the previous snapshot.
9. Deletes the previous collection, to keep memory, and so cost, near one collection's.
10. Writes a summary.

Every step before 8 leaves search untouched. Search only changes when a full, checked snapshot is ready.

**What a run leaves behind:**

- **The job summary** on the run's page in the Actions tab: what was loaded, and the diff.
- **An artifact** named `update-<run id>-<attempt>`, kept for 30 days, with `data/diff/` (the diff in full) and `data/runs/` (the summary and `result.json`).
- **On failure,** an issue labeled `daily-update` with the step, the message and a link to the run.

### The change limits

A run stops before importing anything if:

| The new snapshot has | Why that points to a broken file |
|---|---|
| Fewer records than the loaded one | Upstream's count has never fallen (spike S1, plan 003) |
| More than 50 records removed | A file cut short |
| More than 100 records with a filled field now empty | A column exported empty |
| More than half the records changed | Columns shifted |

Retraction Watch's own large edits pass: the largest single update seen changed 655 records, and the largest month 32% of them. The diff reports them all.

### Reading the diff

The job summary shows `diff.md`. In the artifact, `diff/<loaded>_to_<new>/` holds `diff.md` and `diff.json`.

- **The counts table:** records added, removed and changed, and records with a field emptied.
- **The per-column table:** how many records changed in each column, and how many of those were emptied.
- **Notice-type changes,** in full, and reason changes, up to 500 lines.
- **Record IDs** added, removed and changed, up to 200 each. `diff.json` has every one.

It compares the text as Retraction Watch published it, not the cleaned values, and shows no titles or author names. To look up a record, open `/record/<Record ID>` on the site.

To diff two snapshots on the laptop: `npm run download -- --commit <sha>` for each, then `npm run diff -- --from <csv> --to <csv>`, which writes to `data/diff/`.

## When something fails

### An issue labeled `daily-update`

Open the run from the link in the issue. The issue gives the step that failed and its message. Search keeps serving the last good snapshot in every case below.

- **Upstream is stale** ("more than the limit of 3"): check the commits on GitLab. Over long holidays, such as late December, upstream may simply not commit: the check counts working days but knows no holidays. Wait, and the first run after upstream's next commit closes the issue. If upstream has moved the file, the pipeline needs a change.
- **A change limit:** read the diff. If the changes are real edits, let one run past the limits (below). If they look broken, wait for the next upstream commit.
- **Download:** the message says which check stopped it ([data issues](data-issues.md#checks-that-stop-a-run) lists them).
  - "isn't valid UTF-8": upstream published a file that lost text, as on 2026-10-15 and from 2026-10-19 to 2026-10-21 (see [data issues](data-issues.md#file-format)). Nothing on this side can fix the file, and **accept_changes** doesn't skip this check. Wait: the first run after upstream's next UTF-8 file loads it and closes the issue.
  - "Download failed", "is empty" or "doesn't match GitLab's file": the download broke on the way. Rerun.
  - Any other download error, or one that comes back after a rerun: upstream's file may have changed format, as on 2026-10-22 (issue #24). Compare the file with the last one that loaded. A format change needs a pipeline change; record it in data issues.
- **Cleaning:** upstream's file may have changed format, as on 2026-10-15. Compare the file with the last one that loaded. A format change needs a pipeline change; record it in data issues.
- **The check of stored records** failed twice: Typesense changed text it stored. Rerun once. If it fails again, see decision record 004.
- **A check after the switch:** the alias already went back. Rerun once. If it fails again, the pipeline needs looking into; the message says which count differed.
- **A timeout or a cancelled run:** rerun.

### Rerun a failed day

A failed first run is retried by the schedule's second run, six to eight hours later. To rerun at once, after fixing the cause:

1. Open the repository's **Actions** tab, then **Update** in the list of workflows.
2. Click **Run workflow**, leave the branch on `main` and every input as it is, and click **Run workflow**.
3. The run loads the newest snapshot, or says "up to date". A successful run closes the issue.

### An issue labeled `site-check`

The check loads the start page and `/api/health`, and expects HTTP 200, `ok` and more than zero records. The issue gives the step that failed and the HTTP status, but not the address.

1. Open the site. If it shows "Search is unavailable right now", the site can't reach the search server: check Railway (the service's status and the usage limit), then the last daily update.
2. If the site doesn't load at all, check Vercel: the latest deployment's status, and the usage page for a paused allowance.
3. If a deployment broke it, roll the site back (below).

The next passing check closes the issue. To check sooner, start **Site check** by hand from the Actions tab.

### An issue labeled `schedule-keepalive`

GitHub turns off a public repository's scheduled workflows after 60 days without activity. Each successful update asks GitHub to keep both schedules on, but GitHub's docs don't say whether that counts. So from day 45 without a commit on `main`, the update opens this issue. Any commit on `main` resets the count. If the schedules were turned off anyway, turn them back on in the Actions tab (each workflow's page shows an **Enable workflow** button).

## The search server

### Load a given snapshot, or roll back the data

Search can go back to any upstream commit. The previous collection is deleted after each update, so this is a fresh load of that commit, which takes one or two minutes.

1. Find the commit in upstream's history of `retraction_watch.csv`: https://gitlab.com/crossref/retraction-watch-data/-/commits/main/retraction_watch.csv. Copy its full SHA.
2. Open **Actions**, **Update**, **Run workflow**. Paste the SHA into **commit**. Tick **accept_changes**: an older snapshot has fewer records, which the change limits stop on.
3. When it's done, the site's footer shows that snapshot's date and commit.
4. To come back to the newest, run the workflow again with every input empty.

The rollback only lasts until the next scheduled run, which loads the newest snapshot again. To hold an older one for longer, open the **Update** workflow in the Actions tab and choose **Disable workflow** from its ⋯ menu, and enable it again when you're ready.

From the laptop, the same load is:

```bash
npm run update -- --server-env .env.hosted --commit <sha> --accept-changes
```

### Let one run past the change limits

Read the diff first: the run that stopped uploaded it. If the changes are real, run the workflow by hand with **accept_changes** ticked and nothing else. The summary records that the limits were overridden. From the laptop: `npm run update -- --server-env .env.hosted --accept-changes`.

### Reload the same snapshot

To rebuild the index from the snapshot the server already has, run the workflow with **force** ticked.

### Change the admin key

Do this if the key may have leaked. The site uses its own key and keeps searching through steps 1 to 4, apart from the restart in step 2.

1. Make a new key on the laptop: `openssl rand -hex 32`.
2. In Railway, open the Typesense service's **Variables**, set `TYPESENSE_API_KEY` to the new key, and deploy the change. The service restarts. For about half a minute, search may fail or see a partly loaded collection (spike S3, plan 003).
3. In GitHub, **Settings**, **Environments**, **search**: update the secret `TYPESENSE_ADMIN_KEY`.
4. In `.env.hosted`, replace `TYPESENSE_ADMIN_KEY`.
5. Run the **Update** workflow by hand. "Up to date" confirms the new key works.
6. Open the site and run a search. The site key was created through Typesense's API and is stored with the data, so it should survive the change, but that's unverified. If search fails, change the search key (below).

### What happens at Railway's spending limit

Railway's Hobby plan has a $50 hard limit and a custom email alert at $10. Railway also emails at 75%, 90% and 100% of the hard limit. At the limit, "all your workloads will be taken offline" (Railway docs, checked 2026-10-14). Expected cost is about $5 a month (decision record 002, spike S3).

When it's offline:

- The site stays up but says "Search is unavailable right now", and downloads fail. The site check fails and opens an issue.
- The daily update fails, since it can't reach the server, and opens an issue.
- Search comes back when the limit is raised or the month resets. The volume keeps the data, so the next update finds the server up to date. If the volume was lost, the next update loads the newest snapshot from scratch.

### Set up the search server from scratch

For a new Railway project, or if the old one is gone. The steps need a Railway account with a payment method.

1. Create a Railway account and subscribe to Hobby.
2. Set the hard usage limit to $50 and a custom email alert at $10.
3. Create a project with one service from the Docker image `typesense/typesense:30.2`.
4. Add a volume mounted at `/data`.
5. Set the service's variables:
   - `TYPESENSE_DATA_DIR=/data`
   - `TYPESENSE_API_KEY`: a new key from `openssl rand -hex 32`, never the local one
   - `TYPESENSE_THREAD_POOL_SIZE=8` and `TYPESENSE_NUM_COLLECTIONS_PARALLEL_LOAD=4`: without them, Typesense counts the host's CPUs, can't create that many threads and stops on every start
   - `PORT=8108`: Railway's healthcheck connects on `PORT`, and Typesense listens on 8108
6. Generate a public domain pointing at port 8108, and set the healthcheck path to `/health`.
7. Check `https://<domain>/health` answers `{"ok":true}`, and that `https://<domain>/collections` without a key gets HTTP 401.
8. Put the address and key in GitHub's `search` environment (`TYPESENSE_URL`, `TYPESENSE_ADMIN_KEY`) and in `.env.hosted`.
9. Run the **Update** workflow by hand. With an empty server it loads the newest snapshot, with nothing to diff against.
10. Make the site's key: `npm run site-key -- --server-env .env.hosted`. Then give the site the new address and key, as in "Change the search key" below.

## The website

### How it deploys

- **Production:** every merge to `main` builds and deploys the site from the `web` folder, in under a minute. The deployment's status shows on the commit in GitHub.
- **Previews:** every pull request gets its own deployment, behind a Vercel login (Standard Protection). Its link is in the Vercel bot's comment on the pull request.
- **Settings:** a changed variable only reaches the site with the next deployment. To apply one without a code change, open **Deployments** in Vercel, open the ⋮ menu on the current production deployment and choose **Redeploy**.

### Roll the site back

Use this when a deployment breaks the site. To undo a bad data load, roll back the data instead (above).

On Hobby, Vercel can roll back to the immediately previous production deployment only (Vercel docs, checked 2026-10-19).

1. In Vercel, open the project. On the **Production Deployment** tile, click **Instant Rollback**.
2. Check the deployment it offers, click **Continue**, then **Confirm Rollback**. The switch is immediate.
3. While rolled back, merges to `main` still build but don't go live. Once a fix is merged, click **Undo Rollback** on the same tile, choose the deployment to make live, and confirm. New merges then go live as before.

A rollback brings back the old deployment's variables too. After a change of the search key, rolling back to a deployment from before it breaks search: redeploy instead.

### Change the search key

Do this if the site key may have leaked, or after moving the search server. `npm run site-key` deletes the site's older keys as it makes a new one, so search on the site is down from step 2 until step 4 finishes, usually a minute or two. Have Vercel's settings open before starting.

1. In `.env.hosted`, delete the line `TYPESENSE_SEARCH_KEY=…`.
2. Run `npm run site-key -- --server-env .env.hosted`. It creates a key, writes it to `.env.hosted`, deletes the old one, and prints the new key's id, never the key.
3. In Vercel, **Settings**, **Environment Variables**: set `TYPESENSE_SEARCH_KEY` to the new value, for Production and Preview, marked sensitive. Open `.env.hosted` to copy it.
4. Redeploy production (see "How it deploys").
5. Open the site and run a search.

### Change the firewall rule

The rule, published on 2026-10-19 (spike S2, plan 004):

- **If:** the request path does not start with `/_next/static/`
- **Then:** rate limit, fixed window of 60 seconds, 300 requests, counted by IP address, answering 429 (Too Many Requests)

To change it, open **Firewall**, then **Rules**, in the Vercel project. Edit the rule, **Save Rule**, then **Review Changes** and **Publish**, which applies it to production.

Things to know before changing the numbers:

- Browsing faster than a person can sent at most 37 requests a minute, and as fast as a browser can go 230 (spike S2). The limit leaves room for several people behind one address, such as a university network, and for `npm run check:speed -- --url`.
- Hobby's docs list one rate-limit rule per project (checked 2026-10-19), though the dashboard offered three.
- Vercel checks Deployment Protection before firewall rules, so the rule never sees a request that the Vercel login turned away.
- Vercel's own platform protection acts without any rule. A burst of about 100 requests a second from the laptop met its "Security Checkpoint" challenge after 130 requests, and the address stayed challenged for about 10 minutes (2026-10-19).

### Turn on indexing at launch

Until launch, `robots.txt` disallows everything and every page carries `noindex, nofollow`. With indexing on, search engines may index only the start page and the About page (spec 004 AC15). Results pages, record pages and the not-found page keep `noindex, nofollow`, so a search for a person's name doesn't land on a record about someone else with the same name, and crawlers don't walk the filter links. `robots.txt` then allows everything but `/api/`.

1. In Vercel, **Settings**, **Environment Variables**: add `SITE_INDEXING` with the value `on`, for Production only.
2. Redeploy production. `robots.txt` is built with the site, so it changes only with a new deployment.
3. Check the live site:
   - `/robots.txt` reads `Allow: /` and `Disallow: /api/`.
   - The start page (`/`, with no search or filter) and `/about` have `<meta name="robots" content="index, follow">`.
   - A search, such as `/?q=neuron`, and a record page have `<meta name="robots" content="noindex, nofollow">`.

To turn it off again, delete the variable and redeploy.

### What happens at Vercel's limits

The account is on Hobby and has no payment method, so it can't be billed (decision record 005). Each month, Hobby includes 1,000,000 function invocations, 1,000,000 CDN requests, 10 GB of fast origin transfer, 100 GB of fast data transfer and 4 hours of active CPU, among others (Vercel Hobby plan, checked 2026-10-19).

- **Over an allowance,** Vercel stops that feature "in most cases" until 30 days have passed. What visitors see then is unverified.
- **The most likely to run out** is 10 GB of fast origin transfer. It covers about 23,000 to 290,000 results pages, or 150 to 750 downloads of every record, a month (spike S1, plan 004). Repeated full downloads are the risk; downloads have no limit of their own yet.
- **The firewall rule's own allowance** is 1,000,000 requests a month on Hobby.
- **Runtime logs** on Hobby go back 1 hour.

Vercel's **Usage** page shows each allowance for the current month.

### GitHub's limits

Actions are free for a public repository. Artifacts are kept for 30 days and take a few megabytes in all. With no payment method, GitHub blocks usage past its allowances instead of billing it. Scheduled workflows stop after 60 days without activity (see `schedule-keepalive` above).

## Checks and their dates

Manual checks the specs asked for, so the next person knows what has been tried.

| Date | Check | Result |
|---|---|---|
| 2026-10-15 | Railway: `/health` over HTTPS, and a request without a key | `{"ok":true}`, and HTTP 401 without a key |
| 2026-10-15 | Railway: the healthcheck's port | Failed until `PORT=8108` was set |
| 2026-10-15 | Railway: a load from the laptop | The first load took 50 s with every check passing, of which the upload took at most 38 s. Two forced reloads took 96 and 80 s, mostly the laptop's upload |
| 2026-10-15 | Railway: memory | About 510 MB steady with one collection, and 0.9–1.2 GB with two, so the update deletes the previous collection |
| 2026-10-15 | Railway: a restart keeps the data | After a redeploy, the update reported the server up to date in 1 s |
| 2026-10-15 | GitHub `search` environment | Both secrets, and only `main` can use them |
| 2026-10-16 | First update started by hand | Installed only the pipeline, wrote the summary and artifact, kept the key and the address out of the log, and stopped at the download on upstream's changed format, opening issue #13 |
| 2026-10-17 | First scheduled load | Loaded upstream commit `5338abda` (2026-10-16) and closed issue #13 |
| 2026-10-18 | Vercel rollback on Hobby | Previous production deployment only (docs) |
| 2026-10-19 | Preview protection | A pull request's preview asked for a Vercel login in a private window |
| 2026-10-19 | The site key in public places | No 8-character piece of it, or of the admin key, in the repository's history, issues and pull requests, the build log, or the live site's pages, responses and scripts |
| 2026-10-19 | Firewall rule | 296 requests answered, then HTTP 429, at 8 a second. Quick browsing never met it |
| 2026-10-19 | Payment settings | Railway's limits set, and no payment method on Vercel |
| 2026-10-19 | Production opened | Searches the hosted snapshot without a login; `robots.txt` disallows everything; pages carry `noindex` |
| 2026-10-19 | Site check | Passed; failed on a missing path and opened issue #22; passed again and closed it. The address showed in neither the logs nor the issue |
| 2026-10-19 | Live checks | 49 search checks pass on the hosted snapshot; no accessibility violations on five pages; searches 464 ms at the 95th percentile; Largest Contentful Paint 2.27 s |
| 2026-10-26 | First load of upstream's second export, started by hand | Loaded upstream commit `a987928a` (2026-10-23) in 2 minutes, with 73 records added and 145 changed, and closed issue #24. The next scheduled run said up to date, and asked GitHub to keep both schedules on. No part of the admin key, and not the server's host, appears in either run's log or the issue |

Still to do:

- **Recovery** (spec 003, task 18): delete the server's collections and run the update by hand. It should rebuild everything from upstream.
- **Rolling back the data** (spec 003, task 17): load an older commit by hand, then the newest.
- **Rolling back the site** (spec 004, task 15): roll production back to the previous deployment, then undo the rollback.
