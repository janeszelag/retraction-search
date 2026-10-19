import { describe, expect, it } from 'vitest';
import { indexingOn, robotsMeta, robotsRules } from './indexing';

describe('indexing switch (spec 004, task 4, AC10)', () => {
  it('is on only when SITE_INDEXING is "on"', () => {
    expect(indexingOn({ SITE_INDEXING: 'on' })).toBe(true);
    expect(indexingOn({})).toBe(false);
    expect(indexingOn({ SITE_INDEXING: '' })).toBe(false);
    expect(indexingOn({ SITE_INDEXING: 'off' })).toBe(false);
    expect(indexingOn({ SITE_INDEXING: 'true' })).toBe(false);
  });

  it('disallows everything and marks pages noindex, nofollow by default', () => {
    expect(robotsRules({})).toEqual({ rules: { userAgent: '*', disallow: '/' } });
    expect(robotsMeta({})).toEqual({ index: false, follow: false });
  });

  it('allows everything and leaves pages without a robots tag when on', () => {
    expect(robotsRules({ SITE_INDEXING: 'on' })).toEqual({ rules: { userAgent: '*', allow: '/' } });
    expect(robotsMeta({ SITE_INDEXING: 'on' })).toBeUndefined();
  });
});
