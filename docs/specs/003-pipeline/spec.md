# Spec 003: Daily pipeline

Status: approved by the owner, 2026-10-14. AC9 changed with the owner's approval, 2026-10-15. AC22 added with the owner's approval, 2026-10-21. Phase 3 of the [roadmap](../../product-brief.md#roadmap). This phase also sets up the hosted search server, which the roadmap first put in Phase 4 (see Decisions).

## Problem

Specs 001 and 002 turn one snapshot into a working search, but every step is run by hand on the owner's laptop. Retraction Watch's data changes every working day. Over the 40 most recent upstream updates (checked 2026-10-14), each added 6 to 71 records, 40 in a typical update, and removed at most one. Most changed few existing records, but batch edits changed up to 655 in one update. Between mid-November and mid-December 2025, the reasons of 21,239 records changed. The files aren't always clean either: for weeks at a time in 2026, they ended with up to 317 empty rows. A site loaded by hand falls behind within a day, which breaks the brief's freshness guardrail: no more than one working day behind the source.

Phase 3 runs the update by itself every day. It runs on GitHub's machines and loads into a search server that doesn't depend on the laptop. When the source changes shape, or anything else goes wrong, the run fails loudly and search keeps the last good data.

## Users

- **Visitors (researchers and journalists),** indirectly. The data date they see and cite stays current, and a broken upstream file never reaches them.
- **The owner, who runs the site.** They need to know when a run fails and what changed each day, and to recover without watching every run.
- **Phase 4 (launch),** which points the website at the hosted search server set up here.

## Hypothesis

We believe one scheduled job can keep the hosted search server within one working day of the source with no manual steps. The job reuses the existing download, clean and load commands and adds a diff and a few guards. We'll know when the scheduled run keeps the hosted data date current for a week without anyone touching it, and each failure the tests force stops the run with the previous data still searchable.

## Decisions

Made 2026-10-14:

- The hosted search server (Typesense on Railway's Hobby plan, as decision record [002](../../decisions/002-search-engine.md) chose) is set up in this phase, not Phase 4. The scheduled run then has a real server to load into, and the brief's learning milestone (30 days of daily runs) can start. The website on Vercel, its rate-limit store and analytics stay in Phase 4.
- The change limits (AC8) catch what a broken file does: fewer records, removed records, or filled fields going empty. Changed values get only a loose backstop, because Retraction Watch's own batch edits and reclassifications are real changes for the diff to report, not to block. The values come from spike S1 in the plan.
- Failed runs open a GitHub issue, as well as GitHub's own notifications (AC14). Issues in a public repository are public.
- The schedule is kept alive by the "enable workflow" call plus a warning issue from day 45 without a commit (AC15).
- The spec is done after seven consecutive days of unattended runs, including a weekend.

Agreed 2026-10-14, as a change to spec 001 that this spec builds:

- Rows where every field is empty are dropped before cleaning and counted in the profile report ([spec 001](../001-data-cleaning/spec.md), AC2). Some upstream files end with such rows. Today's integrity check rejects them, because they have no Record ID, so without this change every daily run on those files would fail. See [data issues](../../data-issues.md#file-format).

Agreed 2026-10-15, after spike S2 (plan):

- Typesense 30.2 sometimes drops one letter from imported text and still reports success: in 6 of 20 test imports, one or two names lost a letter. The load sends text in a form this can't affect, and checks every stored document against the cleaned file, since the facet-value check from plan 002 sees only about half of the damage. See decision record [004](../../decisions/004-typesense-import-escaping.md).

Agreed 2026-10-21, after upstream's 2026-10-15, 2026-10-19 and 2026-10-20 files:

- A file that isn't UTF-8 stops the download with an error that says so (AC22). Those files were in Windows-1252 and lost every character it can't hold, so they shouldn't load. The run reported a checksum mismatch instead, which reads like a broken download. GitLab computes the SHA-256 it reports on a copy it has converted to UTF-8, and the conversion varies from file to file. So the download is first verified by git blob ID, which GitLab computes on the stored bytes. See [data issues](../../data-issues.md#file-format).

From earlier documents:

- The daily diff reports changed records as well as new ones (product brief, Risks).
- If a run fails or is skipped, search keeps serving the previous data (product brief, How it runs).

## Acceptance criteria

"The server" is whichever Typesense server the run targets: the local one in Docker, or the hosted one on Railway. "The loaded snapshot" is the upstream snapshot the server serves before the run.

**One command**

- AC1: One command runs the whole update against a given server. It finds the newest upstream snapshot, downloads and cleans it, compares it with the loaded snapshot, loads it into a new collection and switches search to it. The same command runs on a laptop against the local server and on GitHub Actions against the hosted one.
- AC2: When the server already has the newest upstream snapshot, the command says so and exits successfully without loading anything. Options force a reload of the newest snapshot, or load a given upstream commit, to reproduce a day or roll back.
- AC3: The server records which upstream commit and data date it serves, and the command reads them from there. Nothing else has to survive between runs, so every run can start on a fresh machine.

**Diff**

- AC4: Every run that loads a snapshot produces a diff against the loaded snapshot, by Record ID: records added, records removed, records changed, the number of changed records for each source column, and the columns changed in each record. It compares the text Retraction Watch published, not the cleaned values, so it reports Retraction Watch's changes rather than the cleaning's.
- AC5: For records whose notice type or reasons changed, the diff gives the old and new values. A changed notice type moves a record between counts, such as an expression of concern that becomes a retraction. Reasons are Retraction Watch's classification and change as new information arrives.
- AC6: The diff can be read on the run's page on GitHub and downloaded as a file for at least 30 days. What the run page shows lists record IDs, column names, counts, notice types and reasons, but no author names or titles. When the server has no loaded snapshot, the run says there's nothing to compare against and continues.

**Failing loudly, keeping the last good data**

- AC7: If any step fails, the run stops before search changes, and the server keeps serving the loaded snapshot. The steps are the download, the column check (spec 001, AC3), the cleaning's integrity checks, the load's checks (spec 002 plan) and the change limits (AC8). The error names the step and the reason.
- AC8: The run stops before switching search if, compared with the loaded snapshot:
  - the new snapshot has fewer records
  - more than 50 records were removed
  - more than 100 records have a field that was filled and is now empty
  - more than half of the records changed

  Spike S1 measured how far normal changes go. Over the 40 updates from 18 August to 14 October 2026, the record count never fell. An update removed at most 1 record, emptied a field in at most 1 record and changed at most 655 (0.9%). Comparing monthly snapshots since October 2025, the record count never fell either. The most in one month were 24 removed, 3 emptied and 21,758 changed (32%). After checking the diff, a person can let one run past the limits, and the run records that.
- AC9: After each import, the load checks that every document Typesense stored matches the cleaned file, field by field. A load that fails the check is retried once. Every retry is reported in the run's summary, so its rate over the first 30 days can be measured.
- AC10: After switching, the run checks through the alias that search returns the new data date and the expected number of records. It also checks that the default view's count (retractions, without revised versions) and the count for each notice type match a DuckDB query on the same snapshot. If any of these checks fails, search goes back to the previous snapshot and the run fails.
- AC11: If the newest upstream snapshot is more than three working days old, the run fails, because the file may have moved or stopped updating. Over the 40 most recent upstream commits (checked 2026-10-14), the longest gap was one missed working day.
- AC22: When upstream's file isn't valid UTF-8, the download stops and the error says so. It gives the number of bytes that aren't valid UTF-8 and the line of the first one, and confirms by git blob ID that the download matches GitLab's file. A download that doesn't match GitLab's file fails with an error of its own. (Added 2026-10-21.)

**Schedule and alerts**

- AC12: A GitHub Actions workflow runs the update every day, after upstream's daily commit, and again later the same day in case the first run was delayed, dropped or failed. Upstream commits at about 23:00 UTC on working days (checked 2026-10-14). The workflow can also be started by hand, with the options from AC2 and AC8. Two runs never overlap.
- AC13: The hosted server serves each upstream snapshot within 24 hours of upstream's commit, unless a run failed and raised an alert (AC14).
- AC14: A failed run alerts the owner in a way that doesn't depend on who last edited the workflow. The alert names the failed step and links to the run. The next successful run says that the problem is resolved.
- AC15: The schedule doesn't stop without warning. GitHub disables scheduled workflows in a public repository after 60 days without repository activity (checked 2026-10-14). The workflow either keeps itself enabled or warns the owner at least two weeks before that would happen.

**Hosted search server**

- AC16: Typesense 30.2, the same image as the local stack, runs on Railway's Hobby plan with its data on a volume. It's reachable only over HTTPS and refuses requests without a key. Railway's hard usage limit is $50 and the email alert is $10, as in decision record 002. This is a manual check, recorded with its date.
- AC17: The admin key lives only in Railway's settings, a GitHub secret that only the update workflow on `main` can read, and, if the owner chooses, a local env file that isn't committed. It never appears in the repository, in workflow logs, in run summaries or in alerts.
- AC18: The daily run never creates, changes or deletes search keys, so the site's key added in Phase 4 keeps working.
- AC19: Restarting or redeploying the server keeps its data. If the volume is lost, a run with no other steps rebuilds the index from the CSV. Both are manual checks.

**Tests on GitHub**

- AC20: Every pull request and every push to `main` runs `npm test` on GitHub Actions, and a failing test marks the pull request. This workflow uses no secrets.

**Running it**

- AC21: A runbook explains, in plain terms, how the daily update works and how to:
  - set up the hosted server from scratch
  - rerun a failed day
  - load a given snapshot or roll back
  - let a run past the change limits
  - change the admin key
  - read the diff
  - tell what happens when Railway's spending limit is reached.

## Done when

All acceptance criteria pass, and the scheduled run has kept the hosted server current for seven consecutive days, including a weekend, with nobody touching it. The brief's learning milestone, 30 days of daily runs with alerts on failure, continues after this spec.

## Success metrics

- Days behind upstream: zero on every working day of that week, measured as the hosted data date against upstream's newest commit.
- A whole run finishes in under 10 minutes on GitHub's runner. Downloading, cleaning and loading take well under a minute each on a laptop.
- The retry rate (AC9) over the first 30 days is recorded, with the date of each retry.
- After the first full week, the hosted server's memory, CPU and bill are compared with decision record 002's estimate of about $5 a month.

## Non-goals

- The website on Vercel, its rate-limit store, analytics, the domain and the site's search key (Phase 4).
- Showing the diff on the site, such as a "new this week" page or a feed. A later candidate.
- Backups of the search index. The CSV is the backup: any run can rebuild the index.
- New cleaning rules. If new data needs one, rule 4 applies: propose a spec change first.
- Alerts outside GitHub (SMS, chat), and uptime monitoring of the search server. Phase 4 decides monitoring together with the site.
- Keeping more than one previous snapshot on the server. Every past snapshot stays available upstream, pinned by its commit.

## Open questions

- **Keeping the schedule alive (AC15):** GitHub's docs don't say what counts as repository activity, or whether its API's "enable workflow" call resets the 60-day count. The warning issue meets AC15 either way. Whether the call alone would be enough only becomes clear if the repository goes 60 days without a commit.
