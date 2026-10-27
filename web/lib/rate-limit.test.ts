import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, endSentence, formatClockTime, formatPeriod, formatWait, judge, windowOf } from './rate-limit';

const at = (time: string) => Date.parse(`2026-10-14T${time}Z`);

describe('rate limit windows (AC28)', () => {
  it('uses the agreed limits', () => {
    expect(DEFAULT_RULES).toEqual({ searches: { max: 60, windowSeconds: 60 }, downloads: { max: 6, windowSeconds: 3600 } });
  });

  it('counts in windows that start on the minute or the hour', () => {
    const search = windowOf(at('15:42:20'), DEFAULT_RULES.searches);
    expect(search.endsAt).toBe(at('15:43:00'));
    expect(windowOf(at('15:42:59.999'), DEFAULT_RULES.searches).index).toBe(search.index);
    expect(windowOf(at('15:43:00'), DEFAULT_RULES.searches).index).toBe(search.index + 1);
    expect(windowOf(at('15:42:20'), DEFAULT_RULES.downloads).endsAt).toBe(at('16:00:00'));
  });

  it('allows the limit itself and refuses the next request until the window ends', () => {
    expect(judge(60, DEFAULT_RULES.searches, at('15:42:20'))).toEqual({ status: 'ok' });
    expect(judge(61, DEFAULT_RULES.searches, at('15:42:20'))).toEqual({ status: 'limited', retryAfter: 40, rule: DEFAULT_RULES.searches });
    expect(judge(7, DEFAULT_RULES.downloads, at('15:42:20'))).toMatchObject({ status: 'limited', retryAfter: 17 * 60 + 40 });
    // Never "try again in 0 seconds".
    expect(judge(61, DEFAULT_RULES.searches, at('15:42:59.900'))).toMatchObject({ status: 'limited', retryAfter: 1 });
  });
});

describe('wording the wait', () => {
  it('says seconds under a minute, then whole minutes rounded up', () => {
    expect(formatWait(1)).toBe('1 second');
    expect(formatWait(40)).toBe('40 seconds');
    expect(formatWait(60)).toBe('1 minute');
    expect(formatWait(17 * 60 + 40)).toBe('18 minutes');
  });

  it('names the period', () => {
    expect(formatPeriod(DEFAULT_RULES.downloads)).toBe('hour');
    expect(formatPeriod(DEFAULT_RULES.searches)).toBe('minute');
  });

  it('writes clock times in AP style', () => {
    expect(formatClockTime(new Date(2026, 9, 14, 15, 0))).toBe('3 p.m.');
    expect(formatClockTime(new Date(2026, 9, 14, 15, 45))).toBe('3:45 p.m.');
    expect(formatClockTime(new Date(2026, 9, 14, 9, 5))).toBe('9:05 a.m.');
    expect(formatClockTime(new Date(2026, 9, 14, 12, 0))).toBe('noon');
    expect(formatClockTime(new Date(2026, 9, 14, 0, 0))).toBe('midnight');
    expect(formatClockTime(new Date(2026, 9, 14, 0, 30))).toBe('12:30 a.m.');
  });

  it('ends a sentence after a clock time with one period', () => {
    expect(endSentence('11:05 p.m.')).toBe('11:05 p.m.');
    expect(endSentence('noon')).toBe('noon.');
  });
});
