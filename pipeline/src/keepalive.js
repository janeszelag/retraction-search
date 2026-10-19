// Keeps the schedules running (spec 003, AC15; spec 004, AC9). GitHub
// disables scheduled workflows in a public repository after 60 days without
// repository activity, so from day 45 after the last commit on main,
// update.yml opens one issue. The first run after a newer commit closes it.
// Each successful update also asks GitHub to keep both scheduled workflows
// enabled. Imports nothing outside Node, like alert.js.
// Usage: node src/keepalive.js --last-commit <ISO date> [--warn-after-days <n>]
//          prints JSON: { due, days, stops_around, title, body }
//        node src/keepalive.js enable   (with GH_REPO set)
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { ghCli } from './gh.js';

// The workflows with a schedule. GitHub turns each one off after the same 60 days.
export const SCHEDULED_WORKFLOWS = ['update.yml', 'site-check.yml'];
export const DISABLED_AFTER_DAYS = 60;
export const WARN_AFTER_DAYS = 45;
const DAY = 24 * 60 * 60 * 1000;

const isoDate = (date) => date.toISOString().slice(0, 10);

export function keepaliveWarning({ lastCommit, now = new Date(), warnAfterDays = WARN_AFTER_DAYS }) {
  const committed = new Date(lastCommit);
  if (Number.isNaN(committed.getTime())) {
    throw new Error(`Can't read the last commit's date: ${lastCommit}`);
  }
  const days = Math.floor((now - committed) / DAY);
  const stopsAround = isoDate(new Date(committed.getTime() + DISABLED_AFTER_DAYS * DAY));
  return {
    due: days >= warnAfterDays,
    days,
    stops_around: stopsAround,
    title: `The daily update stops around ${stopsAround} without a commit`,
    body: [
      `GitHub turns off scheduled workflows in a public repository after ${DISABLED_AFTER_DAYS} days without activity. The last commit on \`main\` was on ${isoDate(committed)}, ${days} days ago, so the daily update's schedule stops around ${stopsAround}.`,
      `To keep it running, merge a pull request or push any commit to \`main\` before then. The first run after that commit closes this issue.`,
      `Each successful run also asks GitHub to keep the workflow enabled, but GitHub's docs don't say whether that counts as activity.`,
      `The site check's schedule stops at the same time.`,
    ].join('\n\n'),
  };
}

// Asks GitHub to keep each scheduled workflow enabled.
export async function enableWorkflows({ repo, gh = ghCli }) {
  for (const file of SCHEDULED_WORKFLOWS) {
    await gh(['api', '--method', 'PUT', `repos/${repo}/actions/workflows/${file}/enable`]);
  }
  return SCHEDULED_WORKFLOWS;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { 'last-commit': { type: 'string' }, 'warn-after-days': { type: 'string' } },
  });
  if (positionals[0] === 'enable') {
    if (!process.env.GH_REPO) {
      throw new Error('Set GH_REPO to the repository (owner/name).');
    }
    const enabled = await enableWorkflows({ repo: process.env.GH_REPO });
    console.log(`Asked GitHub to keep ${enabled.join(' and ')} enabled.`);
    return;
  }
  const warnAfterDays = values['warn-after-days'] === undefined ? WARN_AFTER_DAYS : Number(values['warn-after-days']);
  if (!values['last-commit'] || !Number.isInteger(warnAfterDays) || warnAfterDays < 0) {
    throw new Error('Usage: node src/keepalive.js --last-commit <ISO date> [--warn-after-days <whole number of days>]');
  }
  console.log(JSON.stringify(keepaliveWarning({ lastCommit: values['last-commit'], warnAfterDays })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
