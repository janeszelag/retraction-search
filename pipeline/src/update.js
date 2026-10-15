// Updates a Typesense server to the newest upstream snapshot (spec 003):
// reads what the server has, finds the newest upstream commit, downloads,
// cleans and diffs it, imports it into a new collection, and switches search
// to it. Writes summary.md and result.json to data/runs/<start time>/.
// Usage: npm run update [-- --force] [-- --commit <sha>] [-- --accept-changes] [-- --env-file <path>]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { ColumnCheckError, IntegrityError, runCleaning } from './clean.js';
import { diffMarkdown, runDiff, snapshotName } from './diff.js';
import { downloadSnapshot } from './download.js';
import { fileExists } from './files.js';
import { cleanUp, importSnapshot, readMeta, switchTo } from './load.js';
import {
  cleanDir as defaultCleanDir,
  diffDir as defaultDiffDir,
  rawDir as defaultRawDir,
  relativeToRepo,
  repoRoot,
  runsDir as defaultRunsDir,
} from './paths.js';
import { formatNumber, table } from './reports.js';
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

const describeSnapshot = (snapshot) =>
  snapshot ? `${snapshot.data_date} (upstream commit ${(snapshot.upstream_commit ?? snapshot.commit).slice(0, 8)})` : 'nothing';

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
    ['Started', result.started_at],
    ['Took', `${formatNumber(result.seconds)} s`],
  ];
  const sections = [`# ${heading}`, table(['', ''], rows)];
  if (result.outcome === 'failed') {
    sections.push('## What failed', `Step: ${result.step}`, `Message: ${result.message}`, 'Search still serves the snapshot it had before the run.');
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

    const imported = await step('import', () => importSnapshot({ snapshotDir: cleaned.outputDir, request, log, now: now() }));
    const switched = await step('switch', () =>
      switchTo({ request, imported, upstreamCommit: commit.id, now: now(), log }),
    );
    result.after = describeLoaded(switched.meta);
    await step('clean up', () => cleanUp({ request, current: imported.collection, previous: switched.previous, log }));
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
// then the env file. A file given with --env-file must exist.
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
      'env-file': { type: 'string' },
    },
  });
  // npm runs workspace scripts from pipeline/, but INIT_CWD is where the command was typed.
  const invokedFrom = process.env.INIT_CWD ?? process.cwd();
  const envFile = values['env-file'] ? path.resolve(invokedFrom, values['env-file']) : path.join(repoRoot, '.env.local');
  const { url, key } = await readServerSettings(envFile, { required: Boolean(values['env-file']) });
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
