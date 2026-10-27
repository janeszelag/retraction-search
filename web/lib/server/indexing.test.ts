import { describe, expect, it } from 'vitest';
import { NOT_INDEXED, indexedMetadata, indexingOn, robotsRules, searchPageMetadata } from './indexing';

const ON = { SITE_INDEXING: 'on' };
const INDEXED = { robots: { index: true, follow: true } };

describe('indexing switch (spec 004, task 4, AC10)', () => {
  it('is on only when SITE_INDEXING is "on"', () => {
    expect(indexingOn(ON)).toBe(true);
    expect(indexingOn({})).toBe(false);
    expect(indexingOn({ SITE_INDEXING: '' })).toBe(false);
    expect(indexingOn({ SITE_INDEXING: 'off' })).toBe(false);
    expect(indexingOn({ SITE_INDEXING: 'true' })).toBe(false);
  });

  it('disallows everything and keeps every page noindex, nofollow by default', () => {
    expect(robotsRules({})).toEqual({ rules: { userAgent: '*', disallow: '/' } });
    expect(NOT_INDEXED).toEqual({ index: false, follow: false });
    expect(indexedMetadata({})).toEqual({});
    expect(searchPageMetadata({}, {})).toEqual({});
  });
});

describe('what search engines may index once indexing is on (spec 004, task 22, AC15)', () => {
  it('allows crawling everything but /api/', () => {
    expect(robotsRules(ON)).toEqual({ rules: { userAgent: '*', allow: '/', disallow: '/api/' } });
  });

  it('lets the About page be indexed', () => {
    expect(indexedMetadata(ON)).toEqual(INDEXED);
  });

  it('lets the start page be indexed, including with parameters that set nothing', () => {
    expect(searchPageMetadata({}, ON)).toEqual(INDEXED);
    expect(searchPageMetadata({ page: '1' }, ON)).toEqual(INDEXED);
    expect(searchPageMetadata({ utm_source: 'newsletter' }, ON)).toEqual(INDEXED);
  });

  it('leaves results pages with the layout noindex', () => {
    for (const params of [{ q: 'neuron' }, { page: '2' }, { sort: 'oldest' }, { in_title: 'brain' }, { country: 'China' }, { type: 'all' }, { revisions: 'include' }]) {
      expect(searchPageMetadata(params, ON), JSON.stringify(params)).toEqual({});
    }
  });
});
