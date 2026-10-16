# Tasks 003: Daily pipeline

Status: in progress, 2026-10-15. Follows [plan 003](plan.md). Spike S1 ran during planning; its result is in the plan. Work one task at a time, and tick a task off once its "done when" check passes. If a spike or task shows the spec can't be met as written, stop and propose a spec change first.

The work goes up in three pull requests:

1. **Tasks 1–11** need only the laptop.
2. **Tasks 12–16** add the hosted server and the workflow. GitHub runs scheduled workflows only from `main`, and the `search` environment only allows `main`. So the "done when" checks of tasks 14–16 run right after this pull request merges, and they're ticked in the third one.
3. **Tasks 17–21,** plus the ticks for 14–16, close the spec.

**Before code**

- [x] **1. Spike S2, facet-value check.** Load the newest snapshot 30 times in a row into the local stack and count the facet-check failures. Write the result into the plan's spike list. (AC9)
  - Done when: the result is recorded. If there was more than one failure, the cause has been looked for, and a spec change is proposed if a single retry isn't enough.
  - Result, 2026-10-15: 4 failures in 30 loads, caused by a Typesense bug that drops a letter from imported text. The AC9 change and decision record 004 were agreed with the owner.

- [x] **2. Test workflow.** `.github/workflows/test.yml` runs `npm ci` and `npm test` on pull requests and pushes to `main`. It uses Node 22, `contents: read` and no secrets, with GitHub's own actions pinned to commit SHAs. (AC20)
  - Done when: the pull request shows the check passing, which also confirms that DuckDB's Linux binary installs from the lockfile. A temporary commit with a failing test shows it failing and is then reverted.
  - Result, 2026-10-15: the Test check passed on pull request #10 (38 s) and on the push to `main`, so DuckDB's Linux binary installs from the lockfile. The failing case ran on a throwaway draft, pull request #11, instead of a commit and revert: a test failing on purpose turned the check red (33 s), and the draft was closed unmerged and its branch deleted.

**Cleaning and diff**

- [x] **3. Empty rows.** `pipeline/sql/05_empty_rows.sql` runs after `00_load.sql`. It drops rows where every column is empty or only spaces and keeps their count. The profile's Snapshot section gives the count, and `npm run check` compares records with the rows that have data. Add `test/fixtures/empty-rows.csv` and a line about it in the fixtures README. (Spec 001 AC2)
  - Done when: the plan's tests pass: the fixture cleans to the same output as `sample.csv`, a row with only a Record ID is kept, and a row with a title but no Record ID still stops the cleaning. `npm run check` passes on the 2026-10-09 snapshot and on the 2026-09-22 snapshot (`bd2763d6`), which has 130 empty rows.

- [x] **4. Upstream module.** Move the newest-commit lookup out of `download.js` into `src/upstream.js`, and add the working-day staleness check. (AC11)
  - Done when: unit tests cover weekends, the three-working-day limit and the day after it, and `npm run download` still works.

- [x] **5. Diff.** `sql/40_diff.sql` and `src/diff.js` build `diff_records`, `diff_columns` and `diff_values`, including emptied columns, and write `diff.json`. Add `test/fixtures/sample-next.csv` and `npm run diff -- --from <csv> --to <csv>`. (AC4, AC5)
  - Done when: the plan's fixture tests pass. `npm run diff` from the 2026-10-13 snapshot to the 2026-10-14 one gives 30 added, 0 removed and 4 changed (URLS), as in spike S1.

- [x] **6. Diff report.** `diff.md` has the counts and per-column tables, notice-type and reason changes with their old and new values, and capped lists of record IDs. (AC5, AC6)
  - Done when: tests show the caps, the "…and N more" line, and no title or author text from the fixtures. The 2026-10-08 to 2026-10-09 diff shows 653 changed journal names.

**Load**

- [x] **7. Split the load.** `load.js` becomes `importSnapshot`, `switchTo` and `cleanUp`. Imports escape every non-ASCII character, and after each import the load exports the collection and compares every stored document with the cleaned file, throwing `DocumentCheckError` on a difference (decision record 004). The facet-value check throws `FacetCheckError`. The meta document gains `upstream_commit`, the full SHA from the download's manifest. `npm run load` keeps its key handling, but the three steps never touch keys. (AC3, AC9, AC10, AC18)
  - Done when: the existing load tests pass. New tests show:
    - the import body is pure ASCII and parses back to the same documents
    - a stored document with one letter missing fails the check, while a reordered `original` object passes
    - `switchTo` returns the previous alias target and meta document
    - the three steps make no request to `/keys`

    `npm run load` still loads the 2026-10-09 snapshot with every check passing, and its meta document has `upstream_commit`. Twenty loads in a row pass the check of stored documents.

**Update command**

- [x] **8. Update command.** `src/update.js` and `npm run update`, with `--force`, `--commit` and `--server-env` (named `--env-file` until 2026-10-15; see the plan's spike S3). It reads the meta document, finds the newest commit, downloads both snapshots, cleans, diffs, loads and switches, and writes `result.json` and `summary.md`. A server with no meta document gets a full load and "nothing to compare against". (AC1, AC2, AC3, AC6, AC18)
  - Done when: the plan's tests for AC1, AC2, AC3 and AC18 pass against a fake Typesense client and fake GitLab responses. On the local stack, `npm run update -- --commit 2cf47753` and then `npm run update` move from the 2026-10-13 snapshot to the newest with a diff, and a third run says "up to date".

- [x] **9. Failing loudly.** Every failed step stops the run before the switch and names the step. The change limits (`MAX_REMOVED` 50, `MAX_EMPTIED` 100, `MAX_CHANGED_SHARE` one half, and no fall in records) stop it after the diff, with `--accept-changes` to let one run through. The staleness check from task 4 runs too. (AC7, AC8, AC11)
  - Done when: the plan's tests for AC7, AC8 and AC11 pass, including values one below each limit passing. A stopped run still writes the diff and `result.json`.

- [x] **10. Retry, and the checks after the switch.** Retry the import once on `DocumentCheckError` or `FacetCheckError` only. After the switch, check through the alias:
  - the meta document's data date and commit
  - the document count
  - the default view's count and the count for each notice type, against DuckDB

  If any check fails, put the alias and meta document back and delete the new collection. (AC9, AC10)
  - Done when: the plan's tests for AC9 and AC10 pass, and the summary reports each retry.

- [x] **11. Local end to end.** Run `npm test`, then `npm run update` on the local stack from an empty Typesense, then again, then with a forced reload. Add `npm run update` and `npm run diff` to `CLAUDE.md`. (AC1, AC2, AC3)
  - Done when: each run does what the spec says, and the site at `npm run web` shows the new data date. Tasks 1–11 go up as a pull request.

**Hosted server**

- [ ] **12. Railway setup and spike S3.** The owner's steps first: create the Railway account, subscribe to Hobby, set the $50 hard limit and the $10 alert, then create the service, volume, variables and domain as the plan lists. Then run the checks:
  - HTTPS, and HTTP 401 without a key
  - the port, a load from the laptop with `--server-env .env.hosted`, and the upload time
  - memory with one, two and three collections
  - a restart keeping the data

  Decide whether the hosted server keeps the previous collection (plan trade-off 4). (AC16, AC19)
  - Done when: the results and the decision are in the plan's spike list, and the runbook records each check with its date.

- [x] **13. GitHub environment.** The owner creates the `search` environment, limits it to `main`, and adds the secrets `TYPESENSE_URL` and `TYPESENSE_ADMIN_KEY`. The owner also turns on email for failed workflows in GitHub's notification settings. (AC17)
  - Done when: the environment exists with both secrets, and only `main` can deploy to it.
  - Result, 2026-10-15: GitHub's API shows the `search` environment with the secrets `TYPESENSE_URL` and `TYPESENSE_ADMIN_KEY`, a single deployment branch rule for `main`, and no repository-wide secrets. The branch rule was missing at first, which left the environment open to every branch, and was added the same evening. The owner turned on email for failed workflows, an account setting the API doesn't show.

**Daily workflow**

- [ ] **14. Update workflow.** `.github/workflows/update.yml`. It has the two schedules, `workflow_dispatch` with `commit`, `force` and `accept_changes` passed through environment variables, `concurrency`, the `search` environment, the plan's permissions and a 30-minute timeout. Its steps install only the pipeline workspace, run the update, write the job summary and upload the artifact for 30 days. (AC12, AC13, AC17)
  - Done when: a run started by hand loads the hosted server, and the job summary shows the diff. The artifact downloads, and a second run says "up to date". A search of the logs, the summary and the repository finds no part of the admin key.
  - Partly checked, 2026-10-16: the first run started by hand (run 38841398791, 02:37 UTC) installed only the pipeline's packages on Linux, added `summary.md` to the job summary and uploaded an artifact that downloads. No part of the admin key, and not the server's host, appears in its log, the artifact, issue #13 or the repository's history. It stopped at the download, because upstream's 2026-10-15 file changed format ([data issues](../../data-issues.md#file-format)). Still to check: a run that loads, with its diff, then "up to date".

- [ ] **15. Alerts.** On failure, comment on the open `daily-update` issue or open one with the step, the message and the run's link. On the next success, comment and close it. (AC14)
  - Done when: the plan's manual check passes. A run started with a commit that doesn't exist opens the issue, and the owner gets an email. The next run closes the issue.
  - Partly checked, 2026-10-16: the failed run above opened issue #13, "Daily update failed", with the step, the message and the run's link, so `gh` works on the runner. Still to check: the owner's email, and a successful run closing #13.

- [ ] **16. Keepalive.** Every successful run calls the "enable workflow" endpoint. Every run checks the last commit on `main`, and from day 45 opens one warning issue. (AC15)
  - Done when: a unit test covers the date logic, and a run started by hand with the threshold lowered for that run opens the warning issue once. Tasks 12–16 go up as a pull request before this check and those of tasks 14 and 15 can run.
  - So far, 2026-10-16: on the failed run above, the warning step ran and opened nothing, as expected with a commit that day. The enable call runs only after a successful run, so it's unchecked.

**Running it**

- [ ] **17. Runbook.** `docs/runbook.md`, with the contents the plan lists, written for someone who hasn't run a server before. (AC21)
  - Done when: the owner reads it and follows its rollback steps once: load an older commit by hand, then the newest.

- [ ] **18. Recovery check.** Delete the hosted server's collections, then start the workflow by hand. (AC19)
  - Done when: the run rebuilds the index from the CSV with no other steps, and the runbook records the check with its date.

- [ ] **19. Data issues.** Add the check of stored documents, the change limits and the checks after the switch to "Checks that stop a run" in `docs/data-issues.md`. (The empty-row row was brought up to date with task 3.) (AC7, AC8, AC10)
  - Done when: the page matches what the code does.

- [ ] **20. Unattended week.** Leave the schedule alone for seven consecutive days, including a weekend. Record each day below. Also record each run's length and any facet-check retries, for the success metrics. (AC12, AC13, done when)
  - Done when: the hosted server served every upstream snapshot within 24 hours on all seven days, with nobody touching it.

  | Day | Upstream's newest commit | Hosted data date | Runs (status, length) | Retries |
  |---|---|---|---|---|

- [ ] **21. First-week cost.** Compare the first full week of Railway usage with decision record 002's estimate, and add the measured numbers to its "Expected cost". (Success metrics)
  - Done when: decision record 002 has the measured cost. That completes the spec, and the closing pull request goes up.
