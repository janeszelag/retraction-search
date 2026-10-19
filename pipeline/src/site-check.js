// Checks the live site (spec 004, AC9). site-check.yml runs it every 6 hours:
// it loads the start page and /api/health from SITE_URL, and checks for HTTP
// 200, ok and a total above zero. Nothing it prints or writes names the
// address, since the run's log and the alert issue are public before the site
// is announced. Imports nothing outside Node, like alert.js, so the workflow
// installs no packages.
// Usage: SITE_URL=<address> node src/site-check.js --run-url <url> --comment-file <file>
// Writes the alert comment, what failed or that the site answered, and exits
// 1 when the check fails. Without SITE_URL there's nothing to check yet, so it
// writes nothing and exits 0.
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { formatNumber } from './reports.js';

const TIMEOUT_MS = 30_000;

// Why a request got no answer. Only the error's code: Node's messages can
// name the host.
function noAnswer(error, timeoutMs) {
  if (error?.name === 'TimeoutError') {
    return `no answer within ${timeoutMs / 1000} s`;
  }
  return `couldn't connect (${error?.cause?.code ?? 'fetch failed'})`;
}

export async function checkSite({ siteUrl, fetch = globalThis.fetch, now = () => new Date(), timeoutMs = TIMEOUT_MS }) {
  const checkedAt = now().toISOString();
  const failed = (step, problem, status = null) => ({ ok: false, checked_at: checkedAt, step, status, problem });
  // Keeps any path in SITE_URL, so pointing it at a missing path makes the
  // check fail on purpose (spec 004, task 12).
  let base;
  try {
    base = new URL(siteUrl).href.replace(/\/+$/, '');
  } catch {
    return failed('settings', "SITE_URL isn't a web address");
  }

  // Each step reads the whole answer, as a browser would.
  async function get(step, path, read) {
    let response;
    try {
      response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      return { problem: failed(step, noAnswer(error, timeoutMs)) };
    }
    if (response.status !== 200) {
      await response.arrayBuffer().catch(() => {});
      return { problem: failed(step, `HTTP ${response.status}`, response.status) };
    }
    try {
      return { body: await read(response) };
    } catch (error) {
      return { problem: failed(step, error instanceof SyntaxError ? 'the answer was not JSON' : noAnswer(error, timeoutMs), 200) };
    }
  }

  const start = await get('start page', '/', (response) => response.arrayBuffer());
  if (start.problem) {
    return start.problem;
  }
  const health = await get('health', '/api/health', (response) => response.json());
  if (health.problem) {
    return health.problem;
  }
  if (health.body?.ok !== true) {
    return failed('health', 'the answer was not ok', 200);
  }
  if (!Number.isInteger(health.body.total) || health.body.total <= 0) {
    return failed('health', `the default view's total was ${JSON.stringify(health.body.total ?? null)}`, 200);
  }
  return { ok: true, checked_at: checkedAt, data_date: health.body.dataDate, total: health.body.total };
}

// 2026-10-18T20:47:03.000Z → 2026-10-18 20:47 UTC
const when = (iso) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

// The comment on the site-check issue for a failed check: the step, what went wrong and when.
export function failedComment(result, runUrl) {
  return [`The site check failed at the **${result.step}** step: ${result.problem}.`, `Checked at ${when(result.checked_at)}.`, `Run: ${runUrl}`].join(
    '\n\n',
  );
}

// The comment that closes the issue.
export function resolvedComment(result, runUrl) {
  return [
    `Resolved: the site answered at ${when(result.checked_at)}, with the snapshot of ${result.data_date} and ${formatNumber(result.total)} records in the default view.`,
    `Run: ${runUrl}`,
  ].join('\n\n');
}

async function main() {
  const { values } = parseArgs({ options: { 'run-url': { type: 'string' }, 'comment-file': { type: 'string' } } });
  if (!values['run-url'] || !values['comment-file']) {
    throw new Error('Usage: SITE_URL=<address> node src/site-check.js --run-url <url> --comment-file <file>');
  }
  if (!process.env.SITE_URL) {
    console.log("SITE_URL isn't set, so there's no site to check yet.");
    return;
  }
  const result = await checkSite({ siteUrl: process.env.SITE_URL });
  const comment = result.ok ? resolvedComment(result, values['run-url']) : failedComment(result, values['run-url']);
  console.log(comment.split('\n\n')[0]);
  await writeFile(values['comment-file'], `${comment}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
