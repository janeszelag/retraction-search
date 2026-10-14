import { describe, expect, it } from 'vitest';
import { defaultQuery, effectiveSort, type Query } from './types';
import { LIMITS, parseQuery, queryHref, serializeQuery } from './url';

const parse = (search: string) => parseQuery(new URLSearchParams(search));

// A query that sets every part, with values that need escaping.
function fullQuery(): Query {
  const query = defaultQuery();
  query.q = 'cell & tissue';
  query.terms = [
    { field: 'institution', words: 'University of Toronto', exclude: false },
    { field: 'title', words: 'mouse model', exclude: true },
    { field: 'institution', words: 'Medical School', exclude: false },
    { field: 'author', words: 'Example', exclude: false },
  ];
  query.termMatch.institution = 'all';
  query.authorNames = ["Maria O'Example", 'Jun Sample'];
  query.filters.type = { include: ['Retraction', 'Expression of concern'], exclude: [], match: 'any' };
  query.filters.reason = { include: ['Manipulation of Images', 'Duplication of/in Image'], exclude: ['Error in Data'], match: 'all' };
  query.filters.subject = { include: ['BLS', 'HSC: Medicine - Oncology'], exclude: ['BLS: Neuroscience'], match: 'any' };
  query.filters.country = { include: ['Côte d’Ivoire'], exclude: ['China'], match: 'all' };
  query.filters.article_type = { include: ['Research Article'], exclude: [], match: 'any' };
  query.filters.journal = {
    include: ['2010 International Conference on Optics, Photonics and Energy Engineering (OPEE)'],
    exclude: [],
    match: 'any',
  };
  query.filters.publisher = { include: [], exclude: ['Springer'], match: 'any' };
  query.filters.paywalled = { include: ['Unknown'], exclude: [], match: 'any' };
  query.noticeYears = { from: 2015, to: null };
  query.paperYears = { from: 1753, to: 1969 };
  query.revisions = 'include';
  query.editorialStaff = 'exclude';
  query.sort = 'paper_oldest';
  query.page = 12;
  return query;
}

describe('the default view (AC2, AC16)', () => {
  it('serializes to no parameters', () => {
    expect(serializeQuery(defaultQuery())).toBe('');
    expect(queryHref(defaultQuery())).toBe('/');
  });

  it('is what an empty URL gives', () => {
    expect(parse('')).toEqual(defaultQuery());
  });

  it('selects retractions only and hides revised versions', () => {
    const query = parse('');
    expect(query.filters.type.include).toEqual(['Retraction']);
    expect(query.revisions).toBe('exclude');
  });
});

describe('round trips (AC16)', () => {
  it('keeps every part of a query', () => {
    const query = fullQuery();
    expect(parse(serializeQuery(query))).toEqual(query);
  });

  it('writes the same query the same way', () => {
    const search = serializeQuery(fullQuery());
    expect(serializeQuery(parse(search))).toBe(search);
  });

  it('keeps the order of field-search rows', () => {
    expect(parse('in_title=a&not_in_author=b&in_title=c').terms.map((term) => term.words)).toEqual(['a', 'b', 'c']);
  });

  it('reads the object Next.js passes a page the same way', () => {
    const search = serializeQuery(fullQuery());
    const object: Record<string, string | string[]> = {};
    for (const [key, value] of new URLSearchParams(search)) {
      const existing = object[key];
      object[key] = existing === undefined ? value : [existing, value].flat();
    }
    const query = parseQuery(object);
    // Rows of the same kind are grouped in an object, so only the set of rows is compared.
    expect({ ...query, terms: [] }).toEqual({ ...fullQuery(), terms: [] });
    expect(query.terms).toHaveLength(fullQuery().terms.length);
    expect(query.terms).toEqual(expect.arrayContaining(fullQuery().terms));
  });
});

describe('notice types (AC2)', () => {
  it('selects every type with type=all', () => {
    const query = parse('type=all');
    expect(query.filters.type).toEqual({ include: [], exclude: [], match: 'any' });
    expect(serializeQuery(query)).toBe('type=all');
  });

  it('drops the retractions default once the URL names a type', () => {
    expect(parse('not_type=Correction').filters.type).toEqual({ include: [], exclude: ['Correction'], match: 'any' });
    expect(parse('type=Expression+of+concern').filters.type.include).toEqual(['Expression of concern']);
  });

  it('writes retractions only as no parameter', () => {
    expect(serializeQuery(parse('type=Retraction'))).toBe('');
  });
});

describe('filters (AC5)', () => {
  it('lets only list fields match all of their values', () => {
    const query = parse('reason=A&reason=B&reason_match=all&journal=J&journal_match=all');
    expect(query.filters.reason.match).toBe('all');
    expect(query.filters.journal.match).toBe('any');
    expect(serializeQuery(query)).toBe('reason=A&reason=B&reason_match=all&journal=J');
  });

  it('treats a value that is both included and excluded as excluded', () => {
    expect(parse('country=China&not_country=China').filters.country).toEqual({
      include: [],
      exclude: ['China'],
      match: 'any',
    });
  });

  it('drops repeated and empty values and tidies spaces', () => {
    expect(parse('reason=A&reason=A&reason=&reason=%20%20B%20%20C%20').filters.reason.include).toEqual(['A', 'B C']);
  });
});

describe('years, sort and page (AC8, AC19, AC20)', () => {
  it('reads four-digit years and turns a reversed range around', () => {
    expect(parse('notice_from=2020&notice_to=2015').noticeYears).toEqual({ from: 2015, to: 2020 });
    expect(parse('paper_from=1753').paperYears).toEqual({ from: 1753, to: null });
    expect(parse('notice_from=20155&notice_to=abc&paper_to=-1').noticeYears).toEqual({ from: null, to: null });
  });

  it('leaves the default sort out of the URL', () => {
    expect(parse('sort=newest').sort).toBeNull();
    expect(parse('q=cancer&sort=relevance').sort).toBeNull();
    // Relevance without search text is newest first, the default.
    expect(parse('sort=relevance').sort).toBeNull();
    expect(parse('q=cancer&sort=newest').sort).toBe('newest');
    expect(parse('sort=oldest').sort).toBe('oldest');
    expect(parse('sort=bogus').sort).toBeNull();
  });

  it('uses relevance only when there is search text', () => {
    expect(effectiveSort(parse('q=cancer'))).toBe('relevance');
    expect(effectiveSort(parse(''))).toBe('newest');
    const query = parse('q=cancer&sort=paper_newest');
    expect(effectiveSort(query)).toBe('paper_newest');
    expect(effectiveSort({ ...query, q: '', sort: 'relevance' })).toBe('newest');
  });

  it('reads the page, starting at 1', () => {
    expect(parse('page=3370').page).toBe(3370);
    for (const bad of ['0', '-1', 'abc', '2.5', '']) {
      expect(parse(`page=${bad}`).page).toBe(1);
    }
    expect(serializeQuery(parse('page=1'))).toBe('');
  });
});

describe('untrusted URLs', () => {
  it('ignores parameters it does not know', () => {
    expect(parse('utm_source=newsletter&foo=bar&in_abstract=x&not_year=2020')).toEqual(defaultQuery());
  });

  it('caps how much a URL can ask for', () => {
    const many = (key: string, count: number) =>
      Array.from({ length: count }, (_, index) => `${key}=v${index}`).join('&');
    const query = parse([many('reason', 80), many('author_name', 30), many('in_title', 30)].join('&'));
    expect(query.filters.reason.include).toHaveLength(LIMITS.valuesPerFilter);
    expect(query.authorNames).toHaveLength(LIMITS.authorNames);
    expect(query.terms).toHaveLength(LIMITS.terms);
    expect(parse(`q=${'a'.repeat(LIMITS.textLength + 1)}`).q).toBe('');
  });
});
