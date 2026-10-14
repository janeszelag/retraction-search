// npm run check:speed (spec 002 task 24, AC33). Starts the built site on its own
// port, then:
// - times the full server response for a fixed set of searches, several times
//   each, and reports the 95th percentile against the 300 ms budget
// - runs Lighthouse's mobile test on a shared URL (the brief's example search)
//   five times, and reports the median Largest Contentful Paint against the
//   2.5 s budget (single runs vary by several tenths of a second)
// Needs the local stack and a build: the npm script builds first.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';

const PORT = 3200;
const ORIGIN = `http://localhost:${PORT}`;
const RUNS = 10;
const BUDGET_P95_MS = 300;
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
  throw new Error(`The site didn't start on ${ORIGIN}.`);
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

const site = startSite();
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
  site.kill();
}
console.log(failed ? 'Over budget.' : 'Within budget.');
process.exitCode = failed ? 1 : 0;
