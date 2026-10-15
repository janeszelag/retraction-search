import { describe, expect, it } from 'vitest';
import { keepaliveWarning } from '../src/keepalive.js';

const LAST_COMMIT = '2026-10-15T22:30:00Z';
const after = (days, hours = 0) => new Date(Date.parse(LAST_COMMIT) + (days * 24 + hours) * 60 * 60 * 1000);

describe('the keepalive warning (AC15)', () => {
  it('is not due until 45 whole days after the last commit', () => {
    expect(keepaliveWarning({ lastCommit: LAST_COMMIT, now: after(44, 23) })).toMatchObject({ due: false, days: 44 });
    expect(keepaliveWarning({ lastCommit: LAST_COMMIT, now: after(45) })).toMatchObject({ due: true, days: 45 });
    expect(keepaliveWarning({ lastCommit: LAST_COMMIT, now: after(59) })).toMatchObject({ due: true, days: 59 });
  });

  it('dates the stop 60 days after the last commit', () => {
    const warning = keepaliveWarning({ lastCommit: LAST_COMMIT, now: after(45) });
    expect(warning.stops_around).toBe('2026-12-14');
    expect(warning.title).toBe('The daily update stops around 2026-12-14 without a commit');
    expect(warning.body).toContain('The last commit on `main` was on 2026-10-15, 45 days ago, so the daily update\'s schedule stops around 2026-12-14.');
  });

  it('takes a lower threshold, to test the warning by hand', () => {
    expect(keepaliveWarning({ lastCommit: LAST_COMMIT, now: after(0, 1), warnAfterDays: 0 })).toMatchObject({ due: true, days: 0 });
  });

  it('reads the commit date in the format git prints it', () => {
    expect(keepaliveWarning({ lastCommit: '2026-10-15T16:30:00-06:00', now: after(45) })).toMatchObject({ due: true, days: 45 });
  });

  it('refuses a date it cannot read', () => {
    expect(() => keepaliveWarning({ lastCommit: 'yesterday' })).toThrow("Can't read the last commit's date: yesterday");
  });
});
