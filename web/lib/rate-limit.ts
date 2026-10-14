// Per-visitor limits (spec 002 AC28, plan 002 "Rate limits"): the rules, the
// fixed windows they count in, and the wording of the wait. Pure, so the
// server code and the download button share it and it's unit-tested.

export type LimitKind = 'searches' | 'downloads';

export interface LimitRule {
  max: number;
  windowSeconds: number;
}

// Agreed 2026-10-13.
export const DEFAULT_RULES: Record<LimitKind, LimitRule> = {
  searches: { max: 60, windowSeconds: 60 },
  downloads: { max: 6, windowSeconds: 60 * 60 },
};

export type LimitCheck = { status: 'ok' } | { status: 'limited'; retryAfter: number; rule: LimitRule };

// Windows start at whole minutes or hours, so every visitor's counter for a
// window can share one key and expire with it.
export function windowOf(now: number, rule: LimitRule): { index: number; endsAt: number } {
  const length = rule.windowSeconds * 1000;
  const index = Math.floor(now / length);
  return { index, endsAt: (index + 1) * length };
}

// `count` includes this request. Over the limit, retryAfter is the whole
// seconds until the window ends, as HTTP's Retry-After wants.
export function judge(count: number, rule: LimitRule, now: number): LimitCheck {
  if (count <= rule.max) {
    return { status: 'ok' };
  }
  return { status: 'limited', retryAfter: Math.max(1, Math.ceil((windowOf(now, rule).endsAt - now) / 1000)), rule };
}

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'}`;

// "40 seconds", "1 minute", "52 minutes".
export function formatWait(seconds: number): string {
  return seconds < 60 ? plural(seconds, 'second') : plural(Math.ceil(seconds / 60), 'minute');
}

// "files per hour", for the download notice.
export function formatPeriod(rule: LimitRule): string {
  return rule.windowSeconds === 3600 ? 'hour' : rule.windowSeconds === 60 ? 'minute' : formatWait(rule.windowSeconds);
}

// A clock time in AP style, in the given date's local time zone: "3 p.m.", "3:45 p.m.", "noon".
export function formatClockTime(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  if (minutes === 0 && (hours === 0 || hours === 12)) {
    return hours === 0 ? 'midnight' : 'noon';
  }
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour}${minutes === 0 ? '' : `:${String(minutes).padStart(2, '0')}`} ${hours < 12 ? 'a.m.' : 'p.m.'}`;
}
