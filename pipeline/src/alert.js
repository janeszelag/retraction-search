// Alert issues. A failed run opens one issue per label or comments on it, and
// the next successful run comments on it and closes it: the daily update under
// `daily-update` (spec 003, AC14) and the site check under `site-check` (spec
// 004, AC9). This file also writes the daily update's comments. It imports
// nothing outside Node, so it still works when installing the pipeline's
// packages failed.
// Usage: node src/alert.js failed|resolved --run-url <url>      (prints a daily-update comment)
//        node src/alert.js open --label <label> --title <title> [--description <text>] --body-file <file>
//        node src/alert.js close --label <label> --body-file <file>
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { ghCli } from './gh.js';
import { runsDir as defaultRunsDir } from './paths.js';
import { describeSnapshot } from './reports.js';

// Puts text in a code block, so Markdown and @mentions in a message stay inert
// (a mention would notify that account). The fence is longer than any run of
// backticks in the text.
export function codeBlock(text) {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map(([run]) => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}\n${text}\n${fence}`;
}

function searchNow(result) {
  if (result.switched_back === false) {
    return 'There was no previous snapshot to go back to, so search serves the new one.';
  }
  return result.before ? `Search still serves ${describeSnapshot(result.before)}.` : 'The server had no snapshot loaded before the run.';
}

// A failed run: the step, its message (already free of the server's address
// and key, AC17), what search serves now, and the run's link.
export function failedComment(result, runUrl) {
  if (!result) {
    return [
      'The daily update stopped before the update command wrote its result: installing failed, the update ran out of time, or the run was cancelled.',
      `Run: ${runUrl}`,
    ].join('\n\n');
  }
  if (result.outcome !== 'failed') {
    return [`The update itself finished (${result.outcome}), but a later step of the workflow failed.`, `Run: ${runUrl}`].join('\n\n');
  }
  return [
    `The daily update failed at the **${result.step}** step.`,
    codeBlock(result.message ?? ''),
    `Upstream snapshot: ${result.target ? describeSnapshot(result.target) : 'not found'}. ${searchNow(result)}`,
    `Run: ${runUrl}`,
  ].join('\n\n');
}

// The next successful run, which closes the issue.
export function resolvedComment(result, runUrl) {
  const what = {
    updated: `this run updated search to ${describeSnapshot(result?.after)}`,
    'up-to-date': `this run found the server up to date with ${describeSnapshot(result?.before)}`,
  }[result?.outcome];
  return [`Resolved: ${what ?? 'this run succeeded'}.`, `Run: ${runUrl}`].join('\n\n');
}

// result.json from the newest run folder, or null when there's none. A runner
// starts empty, so in the workflow it's the run that just finished.
export async function readLatestResult(runsDir = defaultRunsDir) {
  const folders = await readdir(runsDir).catch(() => []);
  const newest = folders.sort().at(-1);
  if (!newest) {
    return null;
  }
  try {
    return JSON.parse(await readFile(path.join(runsDir, newest, 'result.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function openIssues(label, gh) {
  const listed = await gh(['issue', 'list', '--label', label, '--state', 'open', '--json', 'number', '--jq', '.[].number']);
  return listed.split('\n').filter((line) => line.trim() !== '').map(Number);
}

// A failure: comments on the newest open issue with the label, or creates the
// label and opens one. New issues and comments notify the repository's watchers.
export async function openAlert({ label, title, description = title, body, gh = ghCli }) {
  const [issue] = await openIssues(label, gh);
  if (issue) {
    await gh(['issue', 'comment', String(issue), '--body', body]);
    return { commented: issue };
  }
  await gh(['label', 'create', label, '--color', 'B60205', '--description', description, '--force']);
  await gh(['issue', 'create', '--title', title, '--label', label, '--body', body]);
  return { opened: true };
}

// A success: comments on and closes every open issue with the label.
export async function closeAlerts({ label, body, gh = ghCli }) {
  const issues = await openIssues(label, gh);
  for (const issue of issues) {
    await gh(['issue', 'close', String(issue), '--comment', body]);
  }
  return issues;
}

const USAGE = [
  'Usage: node src/alert.js failed|resolved --run-url <url>',
  '       node src/alert.js open --label <label> --title <title> [--description <text>] --body-file <file>',
  '       node src/alert.js close --label <label> --body-file <file>',
].join('\n');

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'run-url': { type: 'string' },
      label: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      'body-file': { type: 'string' },
    },
  });
  const [kind] = positionals;
  if (kind === 'open' || kind === 'close') {
    if (!values.label || !values['body-file'] || (kind === 'open' && !values.title)) {
      throw new Error(USAGE);
    }
    const body = (await readFile(values['body-file'], 'utf8')).trim();
    if (kind === 'open') {
      await openAlert({ label: values.label, title: values.title, description: values.description, body });
    } else {
      await closeAlerts({ label: values.label, body });
    }
    return;
  }
  if (!['failed', 'resolved'].includes(kind) || !values['run-url']) {
    throw new Error(USAGE);
  }
  const result = await readLatestResult();
  console.log(kind === 'failed' ? failedComment(result, values['run-url']) : resolvedComment(result, values['run-url']));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
