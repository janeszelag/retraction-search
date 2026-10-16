# Plan 003: Daily pipeline

Status: approved by the owner, 2026-10-14. AC9 changed with the owner's approval, 2026-10-15. How to build [spec 003](spec.md). Decision records [001](../../decisions/001-languages.md) (JavaScript glue, SQL in DuckDB), [002](../../decisions/002-search-engine.md) (Typesense on Railway, $50 hard limit) and [004](../../decisions/004-typesense-import-escaping.md) (escaped imports, stored documents checked) apply.

External facts below were checked on 2026-10-14 unless marked otherwise.

## How it fits together

```
GitHub Actions: update.yml (01:17 and 07:17 UTC, or started by hand)
  └─ npm run update                                  pipeline/src/update.js
       1. read the server's meta document ─► loaded commit and data date
       2. ask GitLab for the newest upstream commit ─► stale? fail (AC11)
          └─ already loaded, and no --force or --commit ─► "up to date", exit 0
       3. download the new snapshot, and the loaded one for the diff      download.js
       4. clean the new snapshot                                          clean.js
       5. diff loaded ─► new                              sql/40_diff.sql, diff.js
       6. change limits (AC8) ─► stop unless --accept-changes
       7. import into a new collection, with its checks          load.js
          └─ a stored document differs ─► delete it and import once more (AC9)
       8. switch the alias, write meta, check through the alias (AC10)
          └─ a check fails ─► alias and meta go back, run fails
       9. delete every other snapshot collection, the previous one included
      10. write summary.md and result.json
  └─ job summary, artifact (diff and summary), failure issue, keepalive

Typesense 30.2 on Railway: volume at /data, HTTPS address, admin key in Railway's variables
```

The same command runs on a laptop against the Docker stack. Every step before 8 leaves search untouched, so a failure there needs no clean-up beyond deleting a half-built collection, which the load already does.

## Layout

```
.github/workflows/
  test.yml                  npm test on pull requests and pushes to main (AC20)
  update.yml                the daily update (AC12–AC15)
pipeline/
  sql/05_empty_rows.sql     drops rows where every field is empty (spec 001 change)
  sql/40_diff.sql           compares two snapshots' source text
  src/diff.js               runs the diff, writes diff.json and diff.md
  src/update.js             the whole update (steps 1–10)
  src/upstream.js           newest upstream commit and working-day staleness, moved out of download.js
  src/load.js               split into import, switch and clean-up steps; escaped imports and a check
                            of stored documents; keys made optional
  test/diff.test.js, test/update.test.js
  test/fixtures/sample-next.csv   sample.csv with rows added, removed and changed
  test/fixtures/empty-rows.csv    sample.csv followed by empty rows, as upstream wrote them
docs/runbook.md             AC21
data/                       not committed
  diff/<loaded>_to_<new>/diff.json, diff.md
  runs/<start time>/summary.md, result.json
```

## Timing (AC12, AC13)

- **Upstream:** the 40 most recent commits that touch `retraction_watch.csv` landed between 23:00:05 and 23:00:57 UTC on working days, apart from one extra commit at 10:43 UTC on 2026-09-25 with the same data date as that evening's. Two working days had no commit: 2026-09-07 and 2026-09-24. So the longest gap was one missed working day.
- **Schedule:** 01:17 UTC, two hours after upstream, and 07:17 UTC as a second attempt. GitHub's docs say scheduled runs "can be delayed during periods of high loads" and that some queued jobs "may be dropped", and that scheduled workflows run only on the default branch. On most days the second run finds the server up to date and exits within a minute.
- **Freshness:** a commit at 23:00 UTC is served by 07:17 UTC the next morning at the latest, unless both runs fail, which raises an alert. That's well inside AC13's 24 hours.
- **Staleness (AC11):** working days are Monday to Friday in UTC, with no holiday calendar. The run fails when upstream's newest commit is more than three working days old, whether or not the server is up to date. Over long holidays, such as late December, this can give a false alarm. The runbook says to check the upstream repository and then wait.

## Where state lives (AC3)

The server's `meta` document is the only state. It already holds the data date, the short commit, the collection, the document count, the load time and the full names of cut facet values (plan 002). The load adds `upstream_commit`, the full SHA, so the run can fetch the loaded snapshot again for the diff.

A runner starts empty, so every run downloads the loaded snapshot again from GitLab. That's about 67 MB (trade-off 1). If the server has no meta document, as on a first load or after a lost volume, the run loads the newest snapshot and says there was nothing to diff against.

## The update command (AC1, AC2)

`npm run update` with these options:

| Option | What it does |
|---|---|
| none | Loads the newest upstream snapshot if the server doesn't have it already |
| `--force` | Loads the newest snapshot even if the server has it |
| `--commit <sha>` | Loads that upstream commit instead, to reproduce a day or roll back. Skips the staleness check. |
| `--accept-changes` | Lets this run past the change limits. The summary says so. |
| `--server-env <path>` | Reads `TYPESENSE_URL` and `TYPESENSE_ADMIN_KEY` from this file instead of `.env.local`, for example `.env.hosted` to target Railway from the laptop. `.gitignore` already excludes `.env.*`. A relative path is read from where the command was typed. Named `--env-file` until 2026-10-15, when spike S3 found that Node intercepts that name. |

Values already in the environment, as on GitHub Actions, take precedence over the file.

- **Exit status:** 0 when the run loaded a snapshot or found the server up to date, 1 when any step failed.
- **`result.json`:** the outcome (`updated`, `up-to-date` or `failed`), the failed step and its message, the snapshot before and after, retries, and whether `--accept-changes` was used. The workflow reads it to write the alert.
- **`summary.md`:** the same information for people, followed by the diff (below).

## Diff (AC4–AC6)

`diff.js` loads both CSVs the way the cleaning does: `00_load.sql`, `05_empty_rows.sql` and the column check. So empty rows never count as records. The loaded snapshot's table is renamed `previous_source`. `40_diff.sql` then:

1. Unpivots each snapshot into one row per record and source column, with the text as Retraction Watch published it, so the SQL doesn't repeat the list of 20 columns. The extra column from the header's trailing comma is always empty, so it never shows up as a change.
2. Joins the two by Record ID and column, and keeps the pairs whose text differs (`IS DISTINCT FROM`, so a value going from empty to filled counts).
3. Builds three results:
   - `diff_records`: Record ID, the change (`added`, `removed` or `changed`), the changed columns, and the columns that went from filled to empty
   - `diff_columns`: the number of changed records per column, and how many of those were emptied
   - `diff_values`: old and new text for `RetractionNature` and `Reason`

Outputs, sorted by Record ID, in `data/diff/<loaded snapshot>_to_<new snapshot>/`:

- **`diff.json`:** everything above, plus both snapshots' commits, data dates and record counts.
- **`diff.md`:**
  - a counts table and the per-column table
  - every notice-type change, and reason changes up to 500 lines
  - up to 200 record IDs each for added, removed and changed records, ending with "…and N more in diff.json" when cut

  It shows no titles or author names (AC6). GitHub's limit on a job summary's size isn't on its current limits page; other sources give 1 MiB per step (unverified). These caps keep `diff.md` far below that.

`npm run diff -- --from <csv> --to <csv>` runs the diff alone, for spike S1 and for exploring by hand.

Spike S1 below has the sizes of real diffs.

## Change limits (AC8)

Four checks, applied after the diff and before anything is imported. The values are constants in `update.js`, from spike S1:

| Check | Stops the run when | Largest seen in one update | Largest seen in one month |
|---|---|---|---|
| Records | the new snapshot has fewer than the loaded one | never fell | never fell |
| `MAX_REMOVED` | more than 50 records are removed | 1 | 24 |
| `MAX_EMPTIED` | more than 100 records have a filled field that's now empty | 1 | 3 |
| `MAX_CHANGED_SHARE` | more than half of the loaded records changed | 655 (0.9%) | 21,758 (32%) |

- **What they catch:**
  - A file cut short trips the first two checks.
  - A column exported empty trips the third.
  - A file whose columns are shifted changes nearly every record, which trips the fourth.
- **What they let through:** Retraction Watch's own large edits. These include a batch of journal names (653 records on 2026-10-09), subjects (228 on 2026-09-22) and the reason reclassification of late 2025. The diff reports them; it doesn't block them.
- **Missed days:** a run after a week or a month of failures diffs all the changes since the loaded snapshot. The month-long pairs in S1 still fall inside every limit.

A run stopped by a limit fails with the numbers and the limit. The diff is still written and uploaded, so the owner can read it before rerunning with `--accept-changes`.

## Empty rows (spec 001 change)

Some upstream files end with rows where every field is empty: 20 commas and nothing else (spike S1). Spec 001's integrity check stops on them, because they have no Record ID and no notice type. The change to spec 001's AC2, agreed on 2026-10-14, drops them instead and counts them:

- **`05_empty_rows.sql`** runs right after `00_load.sql`. It counts the rows where every column is empty or only spaces, keeps that count in a one-row table, and deletes those rows from `source`. Everything after it, including the column check, the cleaning, the diff and `npm run check`, sees only rows with data. The SQL files still run in order in the DuckDB CLI.
- **The profile report's Snapshot section** gives the number of empty rows dropped, so a run on such a file says what it did.
- **A row with any value at all is kept,** and a missing Record ID in it still stops the cleaning.

## Load changes (AC9, AC10, AC18)

`runLoad` in `load.js` becomes three steps that `npm run load` and `npm run update` both call:

1. **`importSnapshot`:** creates the collection and imports it, with every non-ASCII character written as a `\uXXXX` escape (decision record 004). It then runs three checks, and on a failure deletes the collection, as now:
   - **Count (plan 002):** the collection holds as many documents as were imported.
   - **Stored documents (new):** it exports the collection and compares every field of every document with `search-documents.jsonl`, ignoring the order of keys inside the `original` object, which Typesense changes. A difference throws a new `DocumentCheckError`, naming the record and field.
   - **Facet values (plan 002):** it still confirms how Typesense cut names longer than 255 bytes, and throws a new `FacetCheckError`.

   Both new errors are kinds of `ValueCheckError`. The update retries only these two, once. The checks before import (spellings that differ only in capitals or accents, names sharing 255 bytes) depend only on the data, so a retry can't fix them.
2. **`switchTo`:** reads the current meta document, points the alias at the new collection and writes the new meta document. It returns the previous alias target and meta document, so the update can undo it.
3. **`cleanUp`:** deletes collections older than the previous one, as now. The update passes no previous collection, so it deletes every snapshot collection but the new one (trade-off 4). `npm run load` still keeps the previous one.

`npm run load` keeps its key handling (it creates and saves the local site key). `npm run update` never calls it, so the daily run creates, changes and deletes no keys (AC18).

**Checks after the switch (AC10),** through the alias with the admin key:

- the meta document's data date and commit are the new snapshot's
- the alias's collection holds as many documents as the snapshot has rows
- the default view (`notice_type:=Retraction && is_revision:=false`) and a facet count of `notice_type` over all documents match DuckDB on the new `records.parquet`

If any check fails, the alias and meta document go back to their previous values, the new collection is deleted and the run fails. On a first load there's nothing to go back to, so the alias stays on the new collection and the run still fails loudly.

**The previous collection is deleted** once the checks through the alias pass, on the hosted server and locally alike. Keeping it would make going back one alias switch, but spike S3 found it costs $9–12 a month in memory on Railway, which reaches the $10 alert. The owner decided on 2026-10-15 to delete it everywhere, so the command behaves the same wherever it runs. Until the checks pass, the previous collection is still there, so a failed check still puts search back on it. Rolling back later means loading an older commit with `--commit` (and `--accept-changes`, since an older snapshot has fewer records). That takes about a minute, or up to two from the laptop.

## Workflows

Both workflows run on `ubuntu-24.04`, GitHub's standard runner for public repositories: 4 CPUs, 16 GB of RAM and 14 GB of SSD, free in public repositories. They use only GitHub's own actions (`actions/checkout`, `actions/setup-node`, `actions/upload-artifact`), pinned to full commit SHAs with the version in a comment. Node is version 22, as in `package.json`.

**`test.yml` (AC20):** runs on pull requests and on pushes to `main` with `contents: read`. It runs `npm ci`, then `npm test`. It uses no secrets, so pull requests from forks can't reach any. The first run confirms that `npm ci` on Linux installs DuckDB's Linux binary from the macOS-made lockfile.

**`update.yml` (AC12–AC15):**

- **Triggers:** the two schedules, plus `workflow_dispatch` with the inputs `commit`, `force` and `accept_changes`. The inputs reach the command through environment variables, never pasted into a `run:` line, so their text can't run as shell code.
- **`concurrency: daily-update`,** with `cancel-in-progress: false`, so a second run waits for the first instead of overlapping it.
- **`environment: search`:** a GitHub environment holding the secrets `TYPESENSE_URL` and `TYPESENSE_ADMIN_KEY`, with deployments limited to `main`. GitHub Free offers environments for public repositories only. Keeping the URL secret too means logs don't print it. GitHub masks secret values in logs.
- **Permissions:** `contents: read`, `issues: write` (alerts) and `actions: write` (keepalive).
- **`timeout-minutes: 30`.** A job may run for up to 6 hours, but a run that takes 30 minutes has gone wrong. GitHub cancels a job that reaches its limit (workflow syntax docs, checked 2026-10-15), so the update step has its own limit of 20 minutes, which leaves time for the alert.
- **Steps:**
  1. checkout and Node setup
  2. `npm ci --workspace pipeline`, so the site's dependencies aren't installed. Checked on a clean copy of the repository on 2026-10-15: it added 44 packages, none of the site's (Next.js, React, TypeScript, Playwright), and `npm run update` and the pipeline's tests ran with them. The first run on GitHub confirms it on Linux.
  3. `npm run update`
  4. always: append `summary.md` to the job summary, and upload `data/diff/` and `data/runs/` as an artifact kept for 30 days
  5. alert or resolve
  6. keepalive

**Storage:** artifacts in public repositories can be kept from 1 to 90 days, 90 by default. GitHub's limits page lists 500 MB of artifact storage for the Free plan. It doesn't say whether public repositories count against that (unverified). With no payment method on file, GitHub blocks usage past the allowance instead of billing it. A day's diff is tens of kilobytes, so 30 days of artifacts is a few megabytes.

## Alerts (AC14)

- **GitHub's own notifications** for scheduled workflows go to "the user who last modified the cron syntax in the workflow file". That's the owner, as long as they push every change to the schedule. The runbook says how to turn on email for failed workflows in GitHub's notification settings.
- **A GitHub issue,** which doesn't depend on who edited the schedule. On failure, the workflow comments on the open issue labeled `daily-update`, or opens one titled "Daily update failed". The issue gives the step, the message from `result.json` and a link to the run. On the next successful run, the workflow comments with that run's link and closes the issue. It uses the `gh` command with the workflow's own token. The first run confirms that `gh` is on the runner.
  - **The text** comes from `pipeline/src/alert.js`, which reads the run's `result.json`. It imports nothing outside Node, so it works even when installing failed, and the step falls back to a fixed sentence with the run's link if the script can't run at all. The message goes in a code block, so an @mention in it, for example from a journal name, doesn't notify anyone.
  - **When it fires:** on a failed or cancelled run. GitHub's docs don't say whether a step that reaches its time limit counts as failed or cancelled, so both raise the alert. A run the owner cancels by hand opens an issue too, and the next successful run closes it.
  - **The label** `daily-update` is created on the first failure. The keepalive warning (AC15) needs a different label, or a successful run would close it.
- **The manual check for AC14:** start the workflow by hand with a commit that doesn't exist. Confirm that the issue opens and the owner gets an email. Then start a normal run and confirm that it closes the issue.

## Keeping the schedule alive (AC15)

GitHub disables scheduled workflows in a public repository after 60 days without repository activity. Its docs don't say what counts as activity, and the page on enabling workflows doesn't say whether GitHub warns first. Community tools say the "enable workflow" API call resets the count, but that's unverified, and checking it takes 60 days. So two measures:

1. **Every successful run calls the "enable workflow" endpoint** for `update.yml` (`PUT …/actions/workflows/update.yml/enable`, which takes the file name and answers 204; GitHub's REST docs, checked 2026-10-15). It's harmless if it does nothing. The docs page doesn't name the token permission it needs, so the first run confirms that `actions: write` is enough.
2. **Every run checks the date of the last commit on `main`.** From day 45 on, it opens one issue, "The daily update stops around <date> without a commit", unless one is open already. Any push resets the count. This warns at least two weeks ahead, whatever the first measure does.
   - **Details:** `pipeline/src/keepalive.js` holds the date logic, with unit tests. It reads the committer date of the checked-out commit (`git log -1 --format=%cI`). The issue is labeled `schedule-keepalive`, so a successful update doesn't close it. A run under the threshold closes it, as after a newer commit. Without that, an issue left open after a push would hide the next warning 45 days later.
   - **The `warn_after_days` input** (default 45) lowers the threshold for one run started by hand. Task 16's check uses it: a run with 0 opens the issue, a second run with 0 doesn't open another, and a normal run closes it.

## Hosted search server (AC16, AC17, AC19)

**Railway facts:**

- Hobby is $5 a month with $5 of usage included. RAM costs $10 per GB a month, CPU $20 per vCPU a month, volumes $0.15 per GB a month and egress $0.05 per GB. The pricing page prices only outgoing data and doesn't mention incoming data.
- A Hobby service can use up to 48 GB of RAM and 48 vCPUs. Volumes start at 5 GB on Hobby.
- The hard limit's minimum is $10. At the limit, "all your workloads will be taken offline". Custom email alerts don't stop anything, and Railway also emails at 75%, 90% and 100% of the hard limit.
- Redeploying a service with a volume causes "a small amount of downtime". Replicas can't be used with volumes. Daily loads don't redeploy anything, so this only affects image upgrades and setting changes.
- Railway generates a public domain with an automatic TLS certificate. Its networking page doesn't say how the target port is chosen, so spike S3 confirms that.
- Typesense reads its settings from environment variables named after its command-line options: `TYPESENSE_API_KEY` and `TYPESENSE_DATA_DIR` (Typesense 30.0 docs). 30.2 is still the newest stable image; 31.0 is at release candidate 20 (Docker Hub, 2026-10-13).
- Typesense sizes two thread pools from the number of CPUs it sees: requests (`--thread-pool-size`, default `NUM_CORES * 8`) and collections loaded in parallel at startup (`--num-collections-parallel-load`, default `NUM_CORES * 4`) (Typesense 30.2 docs, checked 2026-10-15). On Railway it sees the host's CPUs, and with the defaults it stopped on every start with `std::system_error: Resource temporarily unavailable` while creating threads (spike S3). `TYPESENSE_THREAD_POOL_SIZE=8` and `TYPESENSE_NUM_COLLECTIONS_PARALLEL_LOAD=4` fixed it. Railway's own Typesense template uses the same values, and a Railway forum thread reports the same error fixed the same way (both checked 2026-10-15).
- Railway's healthcheck connects on the port in the service's `PORT` variable. An app listening on another port fails it with "service unavailable" (Railway healthcheck docs, checked 2026-10-15). Typesense listens on 8108 and doesn't read `PORT`, so the service sets `PORT=8108` for the healthcheck alone.

**Setup (the owner's steps, since they need an account and a payment method):**

1. Create a Railway account and subscribe to Hobby.
2. Set the hard limit to $50 and a custom email alert at $10.
3. Create a project with one service from the Docker image `typesense/typesense:30.2`.
4. Add a volume mounted at `/data`.
5. Set the variables `TYPESENSE_DATA_DIR=/data` and `TYPESENSE_API_KEY` to a new random key (`openssl rand -hex 32`), not the local one. Also set `TYPESENSE_THREAD_POOL_SIZE=8`, `TYPESENSE_NUM_COLLECTIONS_PARALLEL_LOAD=4` and `PORT=8108` (Railway facts above).
6. Generate a public domain pointing at port 8108, and set the healthcheck path to `/health`.
7. In GitHub, create the `search` environment, limit it to `main`, and add the two secrets.

**Checks, recorded in the runbook with their dates:**

- `/health` answers over HTTPS, and a request without a key gets HTTP 401.
- After the first load, restarting the service keeps the collections.
- Deleting the collections, then running the workflow by hand, rebuilds them. The volume itself isn't deleted for this check: a run that starts from an empty server is the same case as a lost volume.

**Cost:** decision record 002 expects about $5 a month in all, with a worst case of $50. Spike S3 measured about 510 MB of steady memory with one collection, about $5.10 a month at Railway's prices, and possibly up to about 750 MB ($7.50) after daily loads (trade-off 4). CPU is mostly idle apart from a short load each day. The daily upload of about 110 MB of documents is incoming data, which the pricing page doesn't charge for (unverified, since it doesn't say so outright). Egress is small, since nothing searches the hosted server until Phase 4. The check of stored documents exports about 113 MB after each load, about 3.4 GB a month, or about $0.17 (decision record 004). The success metric compares the first full week with this estimate.

## Runbook (AC21)

`docs/runbook.md` covers: what the daily update does, in the order above; setting up the hosted server from scratch; rerunning a failed day (start the workflow by hand); loading a given snapshot or rolling back (`commit` input, or `--commit` with `--server-env .env.hosted` from the laptop); letting a run past the limits (`accept_changes`, after reading the diff); changing the admin key (Railway variable, restart, GitHub secret, one manual run to confirm); reading the diff; what happens at Railway's spending limit (search goes offline until the limit is raised or the month resets; the next run reloads nothing unless the volume is lost); and the false alarm over long holidays. It's written for someone who hasn't run a server before.

## Tests

| AC | Test |
|---|---|
| AC1 | `update.test.js` runs the whole update against a fake Typesense client and fake GitLab responses, using the fixtures. A manual run against the local stack confirms it for real. |
| AC2 | The fake server already holds the newest commit: the run reports "up to date", exits 0 and makes no write requests. `--force` and `--commit` load anyway. |
| AC3 | The run takes the commit to diff against from the fake meta document, and the meta document it writes has `upstream_commit` |
| AC4, AC5 | `diff.test.js` on `sample.csv` → `sample-next.csv`. The next file adds two rows and removes one. It changes a reason, a notice type, a URL, and a value from empty to filled. Each shows up correctly in all three results. |
| AC6 | `diff.md` caps its lists and contains no title or author text from the fixtures. With no meta document, the run reports nothing to compare against and loads. |
| AC7 | A broken fixture (missing column), a failed download and a failed import each stop the run, name the step, and leave the fake server's alias and meta unchanged |
| AC8 | Fewer records, 51 removals, 101 emptied records and changes to more than half the records each stop the run. Values one below each limit pass. `--accept-changes` lets a stopped run through and is recorded. |
| Spec 001 AC2 (changed 2026-10-14) | `empty-rows.csv` cleans to the same output as `sample.csv`, and the profile reports the empty rows dropped. A row with only a Record ID is kept. A row with a title but no Record ID still stops the cleaning. |
| AC9 | `load.test.js`: the import body is pure ASCII and parses back to the same documents, including characters outside the Basic Multilingual Plane. A stored document with one letter missing fails the check and names the record and field, while a reordered `original` object passes. `update.test.js`: a fake server that drops a letter on the first import only: the run retries and succeeds, and the summary reports the retry. Failing twice fails the run. Failing the checks before import isn't retried. |
| AC10 | A fake server whose post-switch count is wrong: the alias and meta go back, the new collection is deleted, and the run fails |
| AC11 | Working-day staleness, with dates around weekends and the three-day limit |
| AC12, AC13 | Manual: the workflow runs on its schedule for the done-when week. `tasks.md` records the hosted data date each day against upstream's newest commit. |
| AC14 | Manual check (above) |
| AC15 | A unit test for the 45-day date logic. The issue step is checked once on a run started by hand, with the threshold lowered for that run only. |
| AC16, AC17, AC19 | Manual checks (above). AC17 also gets a search of the repository, the run logs and an alert issue for the key's first eight characters. |
| AC18 | The fake server records every request: the update makes none to `/keys` |
| AC20 | The pull request for this spec shows the test workflow passing, and a commit with a failing test shows it failing |
| AC21 | The owner reads the runbook and follows its rollback steps once |

## Spikes first

- **S1, change limits (AC8). Run 2026-10-14.** 52 upstream snapshots were fingerprinted straight from GitLab with DuckDB: the 41 most recent commits (2026-08-18 to 2026-10-14) and the last commit before the 15th of each month from October 2025 to August 2026. Each record's Record ID was kept, with a hash of each source column. Pairs of commits one update, five updates (about a week), ten (two weeks) and twenty (four weeks) apart were compared, along with consecutive monthly snapshots. Rows where every field is empty were left out (below).

  | Pairs | Count | Added | Most removed | Changed (median, most) | Most emptied | Smallest net change |
  |---|---:|---|---:|---|---:|---:|
  | One update apart | 40 | 6 to 71 (median 40) | 1 | 0, 655 (0.9%) | 1 | +6 |
  | About a week | 36 | 132 to 294 | 1 | 6, 692 (0.95%) | 1 | +131 |
  | About two weeks | 31 | 370 to 484 | 2 | 55, 695 (0.95%) | 1 | +370 |
  | About four weeks | 21 | 773 to 872 | 2 | 356, 1,039 (1.4%) | 1 | +773 |
  | Monthly, 2025-10 to 2026-10 | 12 | 262 to 888 | 24 | 76, 21,758 (32%) | 3 | +262 |

  - **Batch edits:** the largest single updates are batches. One changed 653 journal names (2026-10-09), one 228 subjects (2026-09-22) and one about 100 institutions (2026-09-23).
  - **Reason reclassification:** between mid-November and mid-December 2025, reasons changed on 21,239 records, and on 10,532 more the following month. Monthly samples can't show whether that happened in one update or over several.
  - **Empty rows:** some files end with rows of 20 commas and nothing else, which DuckDB reads as rows with every field empty.
    - **When:** 78 in the 2026-02-13 file, 279 on 2026-06-12, 192 on 2026-07-14 and 264 on 2026-08-14. Every daily file from 2026-08-18 to 2026-09-22 had them, between 130 and 317.
    - **When not:** none in the other monthly samples, and none from 2026-09-23 on.
    - **Where:** in the 2026-09-22 file, all 130 were the last lines.
    - **Effect:** spec 001's cleaning stops on them, which led to the AC2 change above.
  - **Caveat:** before 2026-08-18 only monthly snapshots were compared, so a large one-day change earlier than that would show only in its month's totals.
- **S2, facet-value check (AC9). Run 2026-10-15.** The 2026-10-09 snapshot was imported 70 times into fresh collections on the local stack, without touching the alias. That's 73,100 documents in 15 requests of 5,000 documents, about 7.5 MB each, to Typesense 30.2 in Docker on an Apple-silicon Mac. Two checks were used: the load's facet-value check, and an export of the whole collection compared field by field with `search-documents.jsonl`.

  | Request body | Check | Imports | Imports with a damaged value | Damaged values |
  |---|---|---:|---:|---:|
  | JSON lines in UTF-8, as the load sends them now | facet values | 30 | 4 | 4 |
  | The same | every field of every document | 20 | 6 | 7 |
  | Every non-ASCII character written as `\uXXXX` | every field of every document | 20 | 0 | 0 |

  - **What the damage is:** each damaged value was the cleaned value with exactly one non-ASCII letter missing. They were Cyrillic letters in journal, publisher and author names, and an "é" in an author name. That "é" was the same letter of the same name in two separate imports; every other loss was in a different place. The import reported success for every document.
  - **Not transient:** after a failed facet check, checking the same collection again straight away, after 5 seconds and after 30 seconds returned the same damaged value. Waiting doesn't help; only a new import does.
  - **The facet check sees about half of it:** it reads only journal and publisher values. Three of the six damaged imports in the full comparison had damage only in author names, which no check looks at today.
  - **Cause:** a Typesense bug, open as [typesense/typesense#3071](https://github.com/typesense/typesense/issues/3071) since 2026-09-23. Typesense hands an import body to the import code in pieces of 196,605 bytes (`ACTIVE_STREAM_WINDOW_SIZE` in `include/http_server.h`), and turns each piece into text with an error handler that silently drops invalid UTF-8 (`error_handler_t::ignore` in `include/http_data.h`; both checked in the v30.2 source). When a piece ends inside a character of two or more bytes, the character is lost. The issue's reporters see it on 29.0, 30.1, 30.2 and the 31.0 release candidates.
  - **Why escaping avoids it:** a body with every non-ASCII character written as `\uXXXX` is pure ASCII, so no piece can end inside a character. The issue's deterministic test found the same.
  - **Cost of escaping:** the upload grows from 112.7 MB to 114.2 MB (1.3%), and the import time is unchanged (median 6.4 s against 6.2 s).
  - **Cost of the full comparison:** exporting the whole collection is 112.7 MB and took 3 s locally.
  - **Data loaded before:** the collection the local site served on 2026-10-15 (loaded 2026-10-14) matched the cleaned file exactly.
  - **Decision:** escape every import and check every stored document, with one retry. Agreed with the owner on 2026-10-15 and recorded in decision record [004](../../decisions/004-typesense-import-escaping.md). AC9 changed to match.
- **S3, Railway (AC16, AC19). Run 2026-10-15.** Confirm the port, HTTPS, 401 and restart behavior. Load from the laptop with `--server-env .env.hosted`, timing the upload. Read Railway's memory graph with one, two and three collections loaded.
  - **Startup:** with Typesense's default thread pools, the server stopped on every start, about every 40 seconds, at the first thread it couldn't create. With 8 request threads and 4 parallel loads it started in about 0.1 s on the empty volume.
  - **Port:** the healthcheck failed for its whole 5-minute window until `PORT=8108` was set, though Typesense was ready within 10 s. The public domain points at port 8108.
  - **HTTPS and keys:** `/health` answers `{"ok":true}` over HTTPS, and `/collections` without a key gets HTTP 401 (owner's check, 2026-10-15).
  - **Option name:** the first load from the laptop, `npm run update -- --env-file .env.hosted`, stopped before the script ran, with `node: .env.hosted: not found` and exit code 9. Node 22.21.1 checks that a path given as `--env-file` exists even when it comes after the script name. It looks relative to `pipeline/`, where npm runs the script, and doesn't load the file itself. No test covered the option, so the tests missed it. The option is now `--server-env` (owner's decision, 2026-10-15), and a test runs the real npm command with a path relative to the repository root.
  - **First load from the laptop (2026-10-15, 21:44 UTC):** `npm run update -- --server-env .env.hosted` loaded upstream commit `1af1bfbb` (data date 2026-10-14) into the empty server in 50 s, with every check passing: 73,214 documents imported, every stored document matching the cleaned file, the alias switched, and search counts matching DuckDB (67,497 in the default view). Downloading and cleaning took about 12 s. The other 38 s cover the escaped import, the export of every stored document, the switch and the search checks. The run doesn't time the upload on its own, so the upload took at most 38 s, against about 6 s for the import alone locally.
  - **Memory with one collection** (Railway's Metrics graph, owner's screenshot, 2026-10-15; values read off the chart, so roughly ±20 MB): about 60 MB with no data, a peak of about 750 MB for under a minute during the load, then a steady 530 MB. That's well above the about 280 MB that plan 002's 220 MB fresh-container figure suggests. One possible cause is memory Typesense's allocator keeps after the import and the export (unverified). The restart check below shows whether a fresh start uses less. At $10 per GB a month, 530 MB is about $5.30 a month.
  - **Redeploy with one collection** (about 21:54 UTC, same graph): a peak of about 680 MB for under a minute, then a steady 510 MB. A fresh start uses nearly as much as after the import, so leftover import memory explains 20 MB at most, within the reading error. The extra memory compared with plan 002's figure has another cause. One candidate is that Railway's figure includes the operating system's file cache for the data on the volume, which Docker Desktop's figure leaves out (unverified). Memory came back to the one-collection level rather than the 60 MB of an empty server, so Typesense reloaded the collection from the volume.
  - **Restart keeps the data:** after the redeploy, `npm run update -- --server-env .env.hosted` reported "The server already has the newest upstream snapshot, 2026-10-14 (upstream commit 1af1bfbb)" in 1 s (21:55 UTC). The meta document and the alias survived along with the collection.
  - **Second load, `--force` (21:58 UTC):** 96 s, every check passing, with the first collection kept as the previous one. Downloading and cleaning took about 6 s. The other 90 s, against 38 s on the first load, were mostly the upload: the process had sent 114.6 MB after about 80 s, at roughly 1.4 MB/s, with almost no CPU in use. The laptop's upload speed varies, so a load from the laptop can take a minute or more longer than the first one did. The upload speed from GitHub's runners isn't measured yet.
  - **Third load, `--force` (22:00 UTC):** 80 s, every check passing. Three collections existed during the load, and the oldest was deleted after the checks.
  - **Memory with two and three collections** (same graph, read off the chart, roughly ±30 MB): one collection before the forced loads, about 510 MB. The second load peaked at about 1.03 GB, then held about 910 MB with two collections for the minute before the next load. The third load peaked at about 1.51 GB with three. After the oldest was deleted, memory held about 1.19 GB with two collections until at least 22:09, not the 910 MB seen before. Deleting a collection gave back only part of its memory. The plan expected about 450 MB with two collections and 650 MB with three; Railway shows about twice that.
  - **Cost:** two collections at 0.9–1.2 GB come to $9–12 a month for memory alone, which reaches the $10 alert. One collection at about 510 MB comes to about $5.10.
  - **Decision (owner, 2026-10-15):** `npm run update` deletes the previous collection once the checks pass, locally and on Railway (trade-off 4). Deleting a collection gave back only part of its memory, so the steady level after each daily load may sit above 510 MB, up to about the 750 MB peak of a load with two collections. The unattended week (tasks 20 and 21) shows where it settles.
  - **Restart replays every write since the last snapshot (22:40 UTC):** the owner deleted the unused collection by hand and redeployed. The first listing after the redeploy showed all three of the evening's collections, partly loaded: 46,729, 60,638 and 70,791 documents, two of them already deleted. `/health` was already answering `{"ok":true}`. About 30 s later, only the current collection was left, with all 73,214 documents. Typesense starts from its last snapshot and replays the writes logged since. It takes a snapshot every hour of uptime (`--snapshot-interval-seconds`, default 3600; the docs say "frequent snapshotting helps in faster recovery from a cold start", Typesense 30.2 docs, checked 2026-10-15). The server never ran an hour between redeploys that day, so each start replayed everything from the first one, which had logged "Snapshot does not exist". Two consequences follow. First, memory after a restart can reflect the replay, here three collections at once, rather than what ends up loaded. Second, for about half a minute after a restart, the collection search uses can be partly loaded while `/health` says ok. That matters from Phase 4, when the site searches this server.

## Trade-offs

1. **Downloading the loaded snapshot again for the diff,** instead of keeping state between runs in a GitHub cache or artifact. It costs one more 67 MB download per run, a few seconds on a runner. In return, the meta document is the only state, and losing it costs one diff.
2. **The diff compares published text, not cleaned values.** It reports exactly what Retraction Watch changed. A cleaned value can also change without its record changing, for example when the most common spelling of a journal changes and the merge (spec 002) picks a different one. Those changes don't appear in the diff. The profile report still shows every merge.
3. **GitHub Actions rather than a scheduled job on Railway.** Actions are free in public repositories, running a pipeline on GitHub Actions is one of the brief's learning goals, and the runner's 16 GB of RAM never counts against Railway's limit.
4. **Deleting the previous collection after each load.** Going back takes a load of an older commit, about a minute, instead of one alias switch. In return, memory on Railway stays near one collection's, about $5 a month instead of $9–12 (spike S3). The previous collection stays until the checks pass, so a failed check still puts search back on it.
5. **Issues as alerts are public.** The repository is public anyway, and the site shows its data date, so a failed day is visible either way. The issue history also records how reliable the pipeline is over the 30-day milestone.
6. **Two scheduled runs a day.** The second costs about a minute of free runner time on most days, and it covers a delayed or dropped first run.
7. **A staleness limit without a holiday calendar.** It's simpler, at the cost of a likely false alarm in late December.
8. **Limits on lost data, not on changed values.** A tight limit on changes would have stopped the 2026-10-09 journal batch and the 2025 reason reclassification, both real edits. The cost is that a broken file that changes values without emptying or removing anything, on fewer than half the records, gets through. The diff still reports it, so a reader can spot it.
9. **Dropping empty rows instead of stopping on them.** They carry no data, and they appeared for weeks at a time, so stopping would have kept the site stale for weeks. A row with any value at all still goes through every check.
10. **Checking every stored document after each load.** It costs one export of about 113 MB per load, about $0.17 a month on Railway. In return it catches any change Typesense makes to stored text, not only the import bug that escaping avoids (decision record 004).

## Changes to other documents

- **Product brief:** the roadmap's Phase 3 and 4 rows, for the hosted search server's move (in this pull request).
- **Spec 001 and plan 001:** the AC2 change for empty rows (in this pull request).
- **Data issues:** empty rows under "File format" (in this pull request), and the change limits under "Checks that stop a run" once they're built.
- **`CLAUDE.md`:** `npm run update` and `npm run diff` in the commands table, once they work.
- **Decision record 002:** the first week's measured cost, added to "Expected cost", once known.
- **Decision record 004:** the Typesense import bug and the fix, agreed 2026-10-15 (in the first pull request).
- **Plan 002 and data issues:** the cause of the facet-check failure (in the first pull request). Data issues also gets the check of stored documents under "Checks that stop a run" once it's built.

## Commands

| Command | What it does |
|---|---|
| `npm run update` | Updates the server in `.env.local` to the newest upstream snapshot (options above) |
| `npm run update -- --server-env .env.hosted` | The same, against the hosted server |
| `npm run diff -- --from <csv> --to <csv>` | Diffs two downloaded snapshots into `data/diff/` |

The existing commands (`download`, `clean`, `check`, `load`, `search:up`) keep working as they do now.

## Still open

- Whether GitHub's "enable workflow" call alone keeps the schedule alive (see the spec's open questions).
- When a Typesense release fixes the import bug. [typesense/typesense#3109](https://github.com/typesense/typesense/pull/3109) says it fixes it, and was open and unreviewed on 2026-10-15. Escaping and the check can stay either way (decision record 004).
- **Whether upstream keeps its new format.** The 2026-10-15 file came in Windows-1252, with line breaks in fields, no trailing comma and dates written `M/D/YYYY 12:00:00 AM` ([data issues](../../data-issues.md#file-format)). The workflow's first run, started by hand at 02:37 UTC on 2026-10-16, stopped at the download with a checksum mismatch. Search kept the 2026-10-14 snapshot, and issue #13 opened. The owner decided to wait for the next exports. The new export also replaced every character Windows-1252 can't hold with `?`: 334,843 characters, mostly Cyrillic, in at least 4,732 records. So adapting to the format isn't enough if it stays. The pipeline would need a source that keeps the text, or upstream would need to fix the export. Two gaps in the checks turned up: the cleaning doesn't stop when dates fail to parse, and nothing stops a UTF-8 file that has lost characters this way. Only the change limits would stop either one, and they would let through a loss that touches fewer than half the records.
