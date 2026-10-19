import { describe, expect, it } from 'vitest';
import { checkSite, failedComment, resolvedComment } from '../src/site-check.js';

const SITE = 'https://site.example.test';
const RUN = 'https://github.com/owner/repo/actions/runs/456';
const now = () => new Date('2026-10-18T20:47:03Z');
const HEALTHY = { ok: true, dataDate: '2026-10-16', total: 67400 };

// A stand-in for fetch: answers by path, and records what was asked.
function site(answers = {}) {
  const asked = [];
  async function fetch(url, { signal } = {}) {
    const { pathname } = new URL(url);
    asked.push(pathname);
    const answer = answers[pathname] ?? (pathname === '/' ? new Response('<html>…</html>') : Response.json(HEALTHY));
    return typeof answer === 'function' ? answer(signal) : answer;
  }
  return { fetch, asked };
}

// A failed connection, with a message that names the host, as Node's does.
const unreachable = () => {
  throw new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND site.example.test'), { code: 'ENOTFOUND' }) });
};

const check = (answers, options) => checkSite({ siteUrl: SITE, fetch: site(answers).fetch, now, ...options });

describe('the site check (spec 004, task 6, AC9)', () => {
  it('passes when both pages answer and the default view has records', async () => {
    const { fetch, asked } = site();
    expect(await checkSite({ siteUrl: `${SITE}/`, fetch, now })).toEqual({
      ok: true,
      checked_at: '2026-10-18T20:47:03.000Z',
      data_date: '2026-10-16',
      total: 67400,
    });
    expect(asked).toEqual(['/', '/api/health']);
  });

  it.each([
    ['the start page answers with an error', { '/': new Response('', { status: 500 }) }, { step: 'start page', status: 500, problem: 'HTTP 500' }],
    ['the start page is behind a login', { '/': new Response('', { status: 401 }) }, { step: 'start page', status: 401, problem: 'HTTP 401' }],
    ['the site can\'t be reached', { '/': unreachable }, { step: 'start page', status: null, problem: "couldn't connect (ENOTFOUND)" }],
    [
      'the health check says search is unavailable',
      { '/api/health': Response.json({ ok: false, error: 'Search is unavailable right now.' }, { status: 503 }) },
      { step: 'health', status: 503, problem: 'HTTP 503' },
    ],
    ['the health check isn\'t ok', { '/api/health': Response.json({ ok: false }) }, { step: 'health', problem: 'the answer was not ok' }],
    ['the default view is empty', { '/api/health': Response.json({ ...HEALTHY, total: 0 }) }, { step: 'health', problem: "the default view's total was 0" }],
    ['the total is missing', { '/api/health': Response.json({ ok: true }) }, { step: 'health', problem: "the default view's total was null" }],
    ['the health check answers with a page', { '/api/health': new Response('<html>Not found</html>') }, { step: 'health', problem: 'the answer was not JSON' }],
  ])('fails when %s, naming the step and the problem but not the address', async (_case, answers, expected) => {
    const result = await check(answers);
    expect(result).toMatchObject({ ok: false, checked_at: '2026-10-18T20:47:03.000Z', ...expected });
    expect(JSON.stringify(result)).not.toContain('example.test');
    expect(failedComment(result, RUN)).not.toContain('example.test');
  });

  it('fails when a page doesn\'t answer in time', async () => {
    const hang = (signal) =>
      new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    expect(await check({ '/api/health': hang }, { timeoutMs: 20 })).toMatchObject({ ok: false, step: 'health', problem: 'no answer within 0.02 s' });
  });

  it('keeps a path in SITE_URL, so a missing path fails on purpose', async () => {
    const { fetch, asked } = site({ '/missing/': new Response('', { status: 404 }) });
    expect(await checkSite({ siteUrl: `${SITE}/missing`, fetch, now })).toMatchObject({ ok: false, step: 'start page', problem: 'HTTP 404' });
    expect(asked).toEqual(['/missing/']);
  });

  it('fails without loading anything when SITE_URL isn\'t a web address', async () => {
    const { fetch, asked } = site();
    expect(await checkSite({ siteUrl: 'site.example.test', fetch, now })).toMatchObject({
      ok: false,
      step: 'settings',
      problem: "SITE_URL isn't a web address",
    });
    expect(asked).toEqual([]);
  });
});

describe('the site check\'s alert comments (spec 004, task 6, AC9)', () => {
  it('gives the step, the problem, the time and the run', async () => {
    const result = await check({ '/api/health': Response.json({ ok: false }, { status: 503 }) });
    expect(failedComment(result, RUN)).toBe(
      ['The site check failed at the **health** step: HTTP 503.', 'Checked at 2026-10-18 20:47 UTC.', `Run: ${RUN}`].join('\n\n'),
    );
  });

  it('closes with what the site served', async () => {
    expect(resolvedComment(await check(), RUN)).toBe(
      [
        'Resolved: the site answered at 2026-10-18 20:47 UTC, with the snapshot of 2026-10-16 and 67,400 records in the default view.',
        `Run: ${RUN}`,
      ].join('\n\n'),
    );
  });
});
