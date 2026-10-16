// Updates a Typesense server to the newest upstream snapshot (spec 003):
// reads what the server has, finds the newest upstream commit, downloads,
// cleans and diffs it, imports it into a new collection, and switches search
// to it. Writes summary.md and result.json to data/runs/<start time>/.
// Usage: npm run update [-- --force] [-- --commit <sha>] [-- --accept-changes] [-- --server-env <path>]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { ColumnCheckError, IntegrityError, runCleaning } from './clean.js';
import { diffMarkdown, runDiff, snapshotName } from './diff.js';
import { downloadSnapshot } from './download.js';
import { fileExists } from './files.js';
import { openDatabase, queryRows, sqlString } from './duckdb.js';
import { ALIAS, cleanUp, DocumentCheckError, FacetCheckError, importSnapshot, readMeta, switchBack, switchTo } from './load.js';
import {
  cleanDir as defaultCleanDir,
  diffDir as defaultDiffDir,
  rawDir as defaultRawDir,
  relativeToRepo,
  repoRoot,
  runsDir as defaultRunsDir,
} from './paths.js';
import { describeSnapshot, formatNumber, table } from './reports.js';
import { typesenseClient } from './typesense.js';
import { checkFreshness, dataDateFromCommit, findCommit } from './upstream.js';

// A failed step. The run stops before search changes, and the message names the step (AC7).
export class StepError extends Error {
  constructor(step, cause) {
    super(`${step} failed: ${cause.message}`, { cause });
    this.step = step;
  }
}

// Runs one step, naming it in any error. `name` can be a function of the error,
// for steps whose checks have names of their own.
async function step(name, run) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof StepError) {
      throw error;
    }
    throw new StepError(typeof name === 'function' ? name(error) : name, error);
  }
}

// The change limits (AC8), from spike S1. Over 40 updates, one update removed
// at most 1 record, emptied a field in at most 1 and changed at most 655 (0.9%).
export const MAX_REMOVED = 50;
export const MAX_EMPTIED = 100;
export const MAX_CHANGED_SHARE = 0.5;

// Checks a diff against the limits. Each check has its value, its limit and whether it passed.
export function checkChangeLimits(diff) {
  const loaded = diff.from.records;
  return [
    {
      check: 'records',
      description: 'records in the new snapshot, which must not fall',
      value: diff.to.records,
      limit: loaded,
      passed: diff.to.records >= loaded,
    },
    { check: 'removed', description: 'records removed', value: diff.counts.removed, limit: MAX_REMOVED, passed: diff.counts.removed <= MAX_REMOVED },
    {
      check: 'emptied',
      description: 'records with a filled field now empty',
      value: diff.counts.emptied,
      limit: MAX_EMPTIED,
      passed: diff.counts.emptied <= MAX_EMPTIED,
    },
    {
      check: 'changed',
      description: 'records changed, at most half of those loaded',
      value: diff.counts.changed,
      limit: Math.floor(loaded * MAX_CHANGED_SHARE),
      passed: diff.counts.changed <= loaded * MAX_CHANGED_SHARE,
    },
  ];
}

function describeBrokenLimits(limits) {
  return limits
    .filter((limit) => !limit.passed)
    .map((limit) =>
      limit.check === 'records'
        ? `the new snapshot has ${formatNumber(limit.value)} records, fewer than the ${formatNumber(limit.limit)} loaded`
        : `${formatNumber(limit.value)} ${limit.description.split(',')[0]}, more than the limit of ${formatNumber(limit.limit)}`,
    )
    .join('; ');
}

// Counts from DuckDB on the cleaned records, for the checks after the switch (AC10).
// The default view is what the site shows first: retractions, without revised versions.
export async function expectedCounts(recordsParquet) {
  const rows = await queryRows(
    await openDatabase(),
    `SELECT notice_type, CAST(count(*) AS INTEGER) AS records,
       CAST(count(*) FILTER (WHERE notice_type = 'Retraction' AND NOT is_revision) AS INTEGER) AS default_view
     FROM read_parquet(${sqlString(recordsParquet)})
     GROUP BY notice_type ORDER BY notice_type`,
  );
  return {
    documents: rows.reduce((sum, row) => sum + row.records, 0),
    defaultView: rows.reduce((sum, row) => sum + row.default_view, 0),
    noticeTypes: Object.fromEntries(rows.map((row) => [row.notice_type, row.records])),
  };
}

export const DEFAULT_VIEW_FILTER = 'notice_type:=Retraction && is_revision:=false';

// Asks Typesense through the alias, as the site does, and compares with
// the new meta document and DuckDB's counts. Throws with every difference.
export async function checkThroughAlias(request, { meta, expected }) {
  const search = (query) =>
    request('GET', `/collections/${ALIAS}/documents/search`, { query: { q: '*', per_page: 0, ...query } });
  const problems = [];
  const served = await readMeta(request);
  if (served?.data_date !== meta.data_date || served?.upstream_commit !== meta.upstream_commit) {
    problems.push(
      `the meta document names ${served?.data_date ?? 'nothing'} (${served?.upstream_commit?.slice(0, 8) ?? 'no commit'}), not ${meta.data_date} (${meta.upstream_commit?.slice(0, 8)})`,
    );
  }
  const all = await search({ facet_by: 'notice_type', max_facet_values: 100 });
  if (all.found !== expected.documents) {
    problems.push(`search finds ${all.found} documents, not ${expected.documents}`);
  }
  const defaultView = await search({ filter_by: DEFAULT_VIEW_FILTER });
  if (defaultView.found !== expected.defaultView) {
    problems.push(`the default view finds ${defaultView.found} records, not ${expected.defaultView}`);
  }
  const servedTypes = Object.fromEntries(
    (all.facet_counts.find((facet) => facet.field_name === 'notice_type')?.counts ?? []).map((count) => [count.value, count.count]),
  );
  for (const type of new Set([...Object.keys(expected.noticeTypes), ...Object.keys(servedTypes)])) {
    if ((servedTypes[type] ?? 0) !== (expected.noticeTypes[type] ?? 0)) {
      problems.push(`${type}: ${servedTypes[type] ?? 0} in search, ${expected.noticeTypes[type] ?? 0} in DuckDB`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`Search through the ${ALIAS} alias doesn't match the new snapshot: ${problems.join('; ')}.`);
  }
}

const cleaningStep = (error) =>
  error instanceof ColumnCheckError ? 'column check' : error instanceof IntegrityError ? 'cleaning checks' : 'cleaning';

// What the server serves, from its meta document.
const describeLoaded = (meta) =>
  meta && {
    data_date: meta.data_date,
    commit: meta.commit,
    upstream_commit: meta.upstream_commit ?? null,
    collection: meta.collection,
  };

function describeLimitsOutcome(result) {
  if (!result.limits) {
    return 'not checked';
  }
  if (result.limits.every((limit) => limit.passed)) {
    return 'passed';
  }
  return result.limits_overridden ? 'exceeded, and let through with --accept-changes' : 'exceeded';
}

// summary.md: what the run did, followed by the diff (AC6).
export function summaryMarkdown(result, diff) {
  const heading = {
    updated: `Updated to ${describeSnapshot(result.after)}`,
    'up-to-date': `Up to date: ${describeSnapshot(result.before)}`,
    failed: `Failed at the ${result.step} step`,
  }[result.outcome];
  const rows = [
    ['Outcome', result.outcome],
    ['Before', describeSnapshot(result.before)],
    ['After', describeSnapshot(result.after ?? result.before)],
    ['Upstream snapshot', result.target ? describeSnapshot(result.target) : 'not found'],
    [
      'Options',
      [result.forced && '--force', result.requested_commit && `--commit ${result.requested_commit}`, result.accept_changes && '--accept-changes']
        .filter(Boolean)
        .join(', ') || 'none',
    ],
    ['Change limits', describeLimitsOutcome(result)],
    ['Retries', result.retries.length === 0 ? 'none' : String(result.retries.length)],
    ['Started', result.started_at],
    ['Took', `${formatNumber(result.seconds)} s`],
  ];
  const sections = [`# ${heading}`, table(['', ''], rows)];
  if (result.outcome === 'failed') {
    sections.push(
      '## What failed',
      `Step: ${result.step}`,
      `Message: ${result.message}`,
      result.switched_back === false
        ? 'There was no previous snapshot to go back to, so search serves the new one.'
        : 'Search still serves the snapshot it had before the run.',
    );
  }
  if (result.retries.length > 0) {
    sections.push(
      '## Retries (AC9)',
      table(
        ['Time', 'Step', 'Why'],
        result.retries.map((retry) => [retry.at, retry.step, retry.message]),
      ),
    );
  }
  if (result.limits) {
    sections.push(
      '## Change limits (AC8)',
      table(
        ['Check', 'Value', 'Limit', 'Passed'],
        result.limits.map((limit) => [limit.description, formatNumber(limit.value), formatNumber(limit.limit), limit.passed ? 'yes' : 'NO']),
      ),
    );
  }
  if (diff) {
    sections.push(diffMarkdown(diff, { level: 2 }));
  } else if (result.diff_note) {
    sections.push('## Changes', result.diff_note);
  }
  return `${sections.join('\n\n')}\n`;
}

// Replaces each secret in a message, so result.json, the summary and an alert
// never show the server's address or key (AC17).
export function redact(message, secrets) {
  return secrets.filter(Boolean).reduce((text, secret) => text.split(secret).join('[hidden]'), message);
}

const runFolderName = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

// The whole update. Returns the result that result.json holds; never throws
// for a failed step, so the summary is always written.
export async function runUpdate({
  request,
  fetch: fetchImpl = globalThis.fetch,
  force = false,
  commit: requestedCommit = null,
  acceptChanges = false,
  now = () => new Date(),
  rawDir = defaultRawDir,
  cleanDir = defaultCleanDir,
  diffDir = defaultDiffDir,
  runsDir = defaultRunsDir,
  secrets = [],
  log = console.log,
}) {
  const started = now();
  const runDir = path.join(runsDir, runFolderName(started));
  const result = {
    outcome: null,
    step: null,
    message: null,
    started_at: started.toISOString(),
    seconds: null,
    forced: force,
    requested_commit: requestedCommit,
    accept_changes: acceptChanges,
    limits: null,
    limits_overridden: false,
    retries: [],
    switched_back: null,
    before: null,
    target: null,
    after: null,
    diff: null,
    diff_note: null,
  };
  let diff = null;

  try {
    const meta = await step('read the server', () => readMeta(request));
    result.before = describeLoaded(meta);

    const commit = await step('find the upstream snapshot', () => findCommit(requestedCommit, { fetch: fetchImpl }));
    result.target = { data_date: dataDateFromCommit(commit), commit: commit.short_id, upstream_commit: commit.id, committed_at: commit.committed_date };
    // Whether or not the server is up to date. A given commit is old on purpose.
    if (!requestedCommit) {
      await step('staleness check', () => checkFreshness(commit, now()));
    }

    if (!force && !requestedCommit && result.before?.upstream_commit === commit.id) {
      result.outcome = 'up-to-date';
      log(`The server already has the newest upstream snapshot, ${describeSnapshot(result.target)}.`);
      return result;
    }

    const downloaded = await step('download', () => downloadSnapshot({ commit: commit.id, fetch: fetchImpl, rawDir }));
    log(`Downloaded ${relativeToRepo(downloaded.csvPath)}.`);
    const loadedCommit = result.before?.upstream_commit;
    const previous = loadedCommit
      ? await step('download', () => downloadSnapshot({ commit: loadedCommit, fetch: fetchImpl, rawDir }))
      : null;

    const cleaned = await step(cleaningStep, () =>
      runCleaning({ inputPath: downloaded.csvPath, outputDir: path.join(cleanDir, snapshotName(downloaded.csvPath)) }),
    );
    log(`Cleaned ${cleaned.records} records into ${relativeToRepo(cleaned.outputDir)}.`);

    if (previous) {
      const written = await step('diff', () =>
        runDiff({
          fromPath: previous.csvPath,
          toPath: downloaded.csvPath,
          outputDir: path.join(diffDir, `${snapshotName(previous.csvPath)}_to_${snapshotName(downloaded.csvPath)}`),
        }),
      );
      diff = written.diff;
      result.diff = { ...diff.counts, folder: relativeToRepo(written.outputDir) };
      log(`Diff: ${diff.counts.added} added, ${diff.counts.removed} removed, ${diff.counts.changed} changed.`);

      result.limits = checkChangeLimits(diff);
      if (result.limits.some((limit) => !limit.passed)) {
        const broken = describeBrokenLimits(result.limits);
        if (!acceptChanges) {
          throw new StepError(
            'change limits',
            new Error(`Compared with the loaded snapshot, ${broken}. Read the diff, then rerun with --accept-changes to let this run through.`),
          );
        }
        result.limits_overridden = true;
        log(`Past the change limits (${broken}), and let through with --accept-changes.`);
      }
    } else {
      result.diff_note = result.before
        ? 'Nothing to compare against: the server’s meta document doesn’t record the loaded snapshot’s upstream commit.'
        : 'Nothing to compare against: the server had no loaded snapshot.';
      log(result.diff_note);
    }

    // A check of what Typesense stored can fail where a new import passes, so
    // those two checks get one more import (AC9). Other failures don't.
    const imported = await step('import', async () => {
      try {
        return await importSnapshot({ snapshotDir: cleaned.outputDir, request, log, now: now() });
      } catch (error) {
        if (!(error instanceof DocumentCheckError || error instanceof FacetCheckError)) {
          throw error;
        }
        result.retries.push({ at: now().toISOString(), step: 'import', message: redact(error.message, secrets) });
        log(`Importing once more, because ${redact(error.message, secrets)}`);
        return importSnapshot({ snapshotDir: cleaned.outputDir, request, log, now: now() });
      }
    });

    const expected = await step('count the new snapshot', () => expectedCounts(path.join(cleaned.outputDir, 'records.parquet')));
    const switched = await step('switch', () =>
      switchTo({ request, imported, upstreamCommit: commit.id, now: now(), log }),
    );
    await step('checks after the switch', async () => {
      try {
        await checkThroughAlias(request, { meta: switched.meta, expected });
      } catch (error) {
        try {
          result.switched_back = await switchBack({ request, switched, collection: imported.collection, log });
        } catch (undoError) {
          throw new Error(`${error.message} Going back to the previous collection also failed: ${undoError.message}`);
        }
        throw new Error(
          result.switched_back
            ? `${error.message} Search is back on the previous snapshot.`
            : `${error.message} There was no previous snapshot to go back to, so search serves the new one.`,
        );
      }
      log(`Search through the ${ALIAS} alias matches the new snapshot: ${expected.documents} documents, ${expected.defaultView} in the default view.`);
    });
    result.after = describeLoaded(switched.meta);
    // Only the new collection stays, now that the checks have passed: a second one
    // roughly doubled memory on Railway (spike S3). Going back means --commit.
    await step('clean up', () => cleanUp({ request, current: imported.collection, previous: null, log }));
    result.outcome = 'updated';
    return result;
  } catch (error) {
    result.outcome = 'failed';
    result.step = error.step ?? 'update';
    result.message = redact(error.cause?.message ?? error.message, secrets);
    log(redact(error.message, secrets));
    return result;
  } finally {
    result.seconds = Math.round((now() - started) / 1000);
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    await writeFile(path.join(runDir, 'summary.md'), summaryMarkdown(result, diff));
    result.run_folder = runDir;
  }
}

// TYPESENSE_URL and TYPESENSE_ADMIN_KEY come from the environment first,
// then the env file. A file given with --server-env must exist.
export async function readServerSettings(envFile, { required = false } = {}) {
  if (await fileExists(envFile)) {
    // Node's loader keeps values already in the environment.
    process.loadEnvFile(envFile);
  } else if (required) {
    throw new Error(`Can't find ${envFile}.`);
  }
  const { TYPESENSE_ADMIN_KEY: key, TYPESENSE_URL: url } = process.env;
  if (!key || !url) {
    throw new Error(`Set TYPESENSE_URL and TYPESENSE_ADMIN_KEY in the environment or in ${envFile}.`);
  }
  return { url, key };
}

async function main() {
  const { values } = parseArgs({
    options: {
      force: { type: 'boolean', default: false },
      commit: { type: 'string' },
      'accept-changes': { type: 'boolean', default: false },
      // Not --env-file: Node checks a path given with that name itself, even after
      // the script name, from pipeline/, and exits before this script runs.
      'server-env': { type: 'string' },
    },
  });
  // npm runs workspace scripts from pipeline/, but INIT_CWD is where the command was typed.
  const invokedFrom = process.env.INIT_CWD ?? process.cwd();
  const envFile = values['server-env'] ? path.resolve(invokedFrom, values['server-env']) : path.join(repoRoot, '.env.local');
  const { url, key } = await readServerSettings(envFile, { required: Boolean(values['server-env']) });
  const result = await runUpdate({
    request: typesenseClient({ url, key }),
    force: values.force,
    commit: values.commit ?? null,
    acceptChanges: values['accept-changes'],
    secrets: [url, key],
  });
  console.log(`${result.outcome === 'failed' ? 'Failed' : 'Done'} in ${result.seconds} s. Wrote ${relativeToRepo(result.run_folder)}.`);
  process.exitCode = result.outcome === 'failed' ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
