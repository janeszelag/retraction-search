import { describe, expect, it } from 'vitest';
import {
  checkFreshness,
  dataDateFromCommit,
  rawFileUrl,
  StaleUpstreamError,
  workingDaysBetween,
} from '../src/upstream.js';

describe('commit helpers', () => {
  it('takes the data date from the upstream commit title', () => {
    const commit = {
      title: 'Retraction Watch data for 2026-10-09',
      committed_date: '2026-10-09T23:00:11.000+00:00',
    };
    expect(dataDateFromCommit(commit)).toBe('2026-10-09');
  });

  it('falls back to the commit date when the title has no date', () => {
    const commit = { title: 'Update README', committed_date: '2026-10-12T08:30:00.000+00:00' };
    expect(dataDateFromCommit(commit)).toBe('2026-10-12');
  });

  it('downloads the file at an exact commit', () => {
    expect(rawFileUrl('bc5648dda5e697cc08a5abb4eb005793ffe98425')).toBe(
      'https://gitlab.com/crossref/retraction-watch-data/-/raw/bc5648dda5e697cc08a5abb4eb005793ffe98425/retraction_watch.csv',
    );
  });
});

// 2026-10-09 is a Friday.
const at = (iso) => new Date(iso);
const commitAt = (committedDate) => ({ short_id: 'abcd1234', committed_date: committedDate });

describe('working days since the newest commit (AC11)', () => {
  it('counts nothing on the same day', () => {
    expect(workingDaysBetween(at('2026-10-12T10:43:00Z'), at('2026-10-12T23:30:00Z'))).toBe(0);
  });

  it("doesn't count the weekend", () => {
    const friday = at('2026-10-09T23:00:11Z');
    expect(workingDaysBetween(friday, at('2026-10-10T01:17:00Z'))).toBe(0);
    expect(workingDaysBetween(friday, at('2026-10-11T07:17:00Z'))).toBe(0);
    expect(workingDaysBetween(friday, at('2026-10-12T01:17:00Z'))).toBe(1);
  });

  it('counts across a weekend', () => {
    const thursday = at('2026-10-08T23:00:30Z');
    expect(workingDaysBetween(thursday, at('2026-10-09T01:17:00Z'))).toBe(1);
    expect(workingDaysBetween(thursday, at('2026-10-12T01:17:00Z'))).toBe(2);
    expect(workingDaysBetween(thursday, at('2026-10-13T01:17:00Z'))).toBe(3);
    expect(workingDaysBetween(thursday, at('2026-10-14T01:17:00Z'))).toBe(4);
  });

  it('uses UTC days, whatever offset GitLab gives', () => {
    // 01:00 on Saturday at +02:00 is 23:00 on Friday in UTC.
    expect(workingDaysBetween(at('2026-10-10T01:00:00+02:00'), at('2026-10-12T01:17:00Z'))).toBe(1);
  });
});

describe('the staleness check (AC11)', () => {
  it('passes at the limit of three working days', () => {
    expect(checkFreshness(commitAt('2026-10-12T23:00:05.000+00:00'), at('2026-10-15T07:17:00Z'))).toBe(3);
  });

  it('passes on a Monday after a commit on Thursday evening and none on Friday', () => {
    expect(checkFreshness(commitAt('2026-10-08T23:00:30.000+00:00'), at('2026-10-12T01:17:00Z'))).toBe(2);
  });

  it('fails the working day after the limit', () => {
    const run = () => checkFreshness(commitAt('2026-10-12T23:00:05.000+00:00'), at('2026-10-16T01:17:00Z'));
    expect(run).toThrow(StaleUpstreamError);
    expect(run).toThrow('commit abcd1234, 2026-10-12T23:00:05.000+00:00) is 4 working days old, more than the limit of 3');
  });

  it('fails after a week without a commit, even over a weekend', () => {
    expect(() => checkFreshness(commitAt('2026-10-09T23:00:11.000+00:00'), at('2026-10-18T07:17:00Z'))).toThrow(
      '5 working days old',
    );
  });
});
