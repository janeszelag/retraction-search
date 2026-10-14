import { describe, expect, it } from 'vitest';
import { formatApDate, formatAsPublished, formatDataDate } from './dates';

const seconds = (year: number, month: number, day: number) => Date.UTC(year, month - 1, day) / 1000;

describe('dates (AC9, AC18, AC22)', () => {
  it('writes result dates in AP style', () => {
    expect(formatApDate(seconds(2026, 9, 24))).toBe('Sept. 24, 2026');
    expect(formatApDate(seconds(2013, 8, 1))).toBe('Aug. 1, 2013');
    expect(formatApDate(seconds(2021, 3, 5))).toBe('March 5, 2021');
    expect(formatApDate(seconds(2021, 12, 31))).toBe('Dec. 31, 2021');
  });

  it('handles dates before 1970 and the 1970 placeholder', () => {
    expect(formatApDate(seconds(1756, 6, 24))).toBe('June 24, 1756');
    expect(formatApDate(0)).toBe('Jan. 1, 1970');
  });

  it('says when a date is missing', () => {
    expect(formatApDate(undefined)).toBe('date unknown');
  });

  it('spells out the month of the data date', () => {
    expect(formatDataDate('2026-10-09')).toBe('October 9, 2026');
  });

  it('shows a value as Retraction Watch published it', () => {
    expect(formatAsPublished('6/24/1756 0:00')).toBe('6/24/1756 0:00');
    expect(formatAsPublished('')).toBe('(blank)');
    expect(formatAsPublished(undefined)).toBeNull();
  });
});
