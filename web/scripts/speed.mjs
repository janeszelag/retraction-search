// npm run check:speed [-- --url <address>] (spec 002 task 24, AC33; spec 004
// task 7, AC12). Builds the site and starts it on its own port, or with --url
// uses that site as it is, then:
// - times the full server response for a fixed set of searches, several times
//   each, and reports the 95th percentile against the budget: 300 ms locally
//   (spec 002 AC33), 500 ms for a live site from the owner's laptop (spec 004 AC12)
// - runs Lighthouse's mobile test on a shared URL (the brief's example search)
//   five times, and reports the median Largest Contentful Paint against the
//   2.5 s budget (single runs vary by several tenths of a second)
// Without --url it needs the local stack.
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';

const { values } = parseArgs({ options: { url: { type: 'string' } } });
const PORT = 3200;
const ORIGIN = values.url ? new URL(values.url).origin : `http://localhost:${PORT}`;
const RUNS = 10;
const BUDGET_P95_MS = values.url ? 500 : 300;
const BUDGET_LCP_MS = 2500;
const LIGHTHOUSE_RUNS = 5;

// Searches and filter changes a visitor makes, from the cheapest to the slowest.
const SEARCHES = [
  '/',
  '/?type=all&revisions=include',
  '/?reason=Investigation+by+Journal%2FPublisher&reason=Concerns%2FIssues+about+Data&not_country=China&notice_from=2015&notice_to=2020',
  '/?reason=Investigation+by+Journal%2FPublisher&reason=Concerns%2FIssues+about+Data&reason_match=all',
  '/?subject=BLS&not_subject=BLS%3A+Biology+-+Cellular',
  '/?type=all&revisions=include&paper_to=1969',
  '/?publisher=Elsevier&publisher=Springer&publisher=Wiley',
  '/?q=neuron',
  '/?q=of',
  '/?q=cancer&type=all&reason=Manipulation+of+Images&sort=oldest',
  '/?q=nuerons',
  '/?q=10.1002%2Fjcb.23190',
  '/?in_title=brain+tumor&not_country=China',
  '/?page=3370',
];
const SHARED_URL = '/?reason=Manipulation+of+Images&reason=Duplication+of%2Fin+Image&subject=BLS%3A+Neuroscience&notice_from=2015';

const webDir = fileURLToPath(new URL('../', import.meta.url));

function startSite() {
  // High limits, so timing many searches from one address isn't refused.
  const env = { ...process.env, RATE_LIMIT_SEARCHES: '100000', RATE_LIMIT_DOWNLOADS: '1000' };
  const site = spawn(process.execPath, ['scripts/next.mjs', 'start', '--port', String(PORT)], { cwd: webDir, env, stdio: 'ignore' });
  return site;
}

async function waitForSite() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${ORIGIN}/about`)).ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`The site didn't answer at ${ORIGIN}.`);
}

// Milliseconds until the whole page has arrived.
async function time(path) {
  const started = performance.now();
  const response = await fetch(`${ORIGIN}${path}`);
  await response.arrayBuffer();
  if (!response.ok) {
    throw new Error(`${path} answered HTTP ${response.status}.`);
  }
  return performance.now() - started;
}

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

async function serverTimes() {
  // One request each first, so the server has compiled and cached what it needs.
  for (const path of SEARCHES) {
    await time(path);
  }
  const all = [];
  console.log(`Server response, ${RUNS} runs each (ms):`);
  for (const path of SEARCHES) {
    const times = [];
    for (let run = 0; run < RUNS; run += 1) {
      times.push(await time(path));
    }
    all.push(...times);
    console.log(`  median ${percentile(times, 50).toFixed(0).padStart(4)}  p95 ${percentile(times, 95).toFixed(0).padStart(4)}  ${path}`);
  }
  return percentile(all, 95);
}

async function largestContentfulPaint() {
  console.log(`Lighthouse mobile, ${LIGHTHOUSE_RUNS} runs, ${SHARED_URL}`);
  const paints = [];
  for (let run = 0; run < LIGHTHOUSE_RUNS; run += 1) {
    const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new'] });
    try {
      // Lighthouse's default is the mobile test: a phone screen, a slow CPU and a slow network, simulated.
      const { lhr } = await lighthouse(`${ORIGIN}${SHARED_URL}`, { port: chrome.port, onlyCategories: ['performance'], logLevel: 'error' });
      const value = (id) => lhr.audits[id].displayValue;
      console.log(
        `  score ${Math.round(lhr.categories.performance.score * 100)}, FCP ${value('first-contentful-paint')}, LCP ${value('largest-contentful-paint')}, ` +
          `TBT ${value('total-blocking-time')}, CLS ${value('cumulative-layout-shift')}`,
      );
      paints.push(lhr.audits['largest-contentful-paint'].numericValue);
    } finally {
      chrome.kill();
    }
  }
  return percentile(paints, 50);
}

let site = null;
if (!values.url) {
  const build = spawnSync(process.execPath, ['scripts/next.mjs', 'build'], { cwd: webDir, stdio: 'inherit' });
  if (build.status !== 0) {
    throw new Error('The build failed.');
  }
  site = startSite();
}
let failed = false;
try {
  await waitForSite();
  const p95 = await serverTimes();
  console.log(`All searches: p95 ${p95.toFixed(0)} ms (budget ${BUDGET_P95_MS} ms)`);
  failed ||= p95 > BUDGET_P95_MS;
  const lcp = await largestContentfulPaint();
  console.log(`Largest Contentful Paint, median ${(lcp / 1000).toFixed(2)} s (budget ${BUDGET_LCP_MS / 1000} s)`);
  failed ||= lcp > BUDGET_LCP_MS;
} finally {
  site?.kill();
}
console.log(failed ? 'Over budget.' : 'Within budget.');
process.exitCode = failed ? 1 : 0;
