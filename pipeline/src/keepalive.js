// Warns before GitHub turns off the daily schedule (spec 003, AC15). GitHub
// disables scheduled workflows in a public repository after 60 days without
// repository activity, so from day 45 after the last commit on main,
// update.yml opens one issue. The first run after a newer commit closes it.
// Imports nothing outside Node, like alert.js.
// Usage: node src/keepalive.js --last-commit <ISO date> [--warn-after-days <n>]
// Prints JSON: { due, days, stops_around, title, body }.
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

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
    ].join('\n\n'),
  };
}

function main() {
  const { values } = parseArgs({ options: { 'last-commit': { type: 'string' }, 'warn-after-days': { type: 'string' } } });
  const warnAfterDays = values['warn-after-days'] === undefined ? WARN_AFTER_DAYS : Number(values['warn-after-days']);
  if (!values['last-commit'] || !Number.isInteger(warnAfterDays) || warnAfterDays < 0) {
    throw new Error('Usage: node src/keepalive.js --last-commit <ISO date> [--warn-after-days <whole number of days>]');
  }
  console.log(JSON.stringify(keepaliveWarning({ lastCommit: values['last-commit'], warnAfterDays })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
