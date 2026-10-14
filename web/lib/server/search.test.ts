import { describe, expect, it, vi } from 'vitest';
import closeFirst from '../search/fixtures/close-spellings-first.json';
import closeSecond from '../search/fixtures/close-spellings-second.json';
import defaultView from '../search/fixtures/default.json';
import journalsSelected from '../search/fixtures/journals-selected.json';
import metaDocument from '../search/fixtures/meta.json';
import text from '../search/fixtures/text.json';
import { segments } from '../search/parse';
import type { SearchOk } from '../search/types';
import { toTypesense, type TypesenseSearch } from '../query/typesense';
import { parseQuery } from '../query/url';
import { loadMeta, runFacetValueSearch, runSearch } from './search';
import { SearchUnavailableError, type TypesenseClient } from './typesense';
import type { TypesenseResult } from '../search/parse';

type Fixture = { search: string; typos: 'fallback' | 'always'; results: unknown[] };

// A client that answers with recorded responses, in order, and records what it was asked.
function recorded(...fixtures: Fixture[]) {
  const asked: TypesenseSearch[][] = [];
  const client: TypesenseClient = {
    async multiSearch(searches) {
      asked.push(searches);
      const fixture = fixtures[asked.length - 1];
      if (!fixture) {
        throw new Error('no more recorded responses');
      }
      return fixture.results as TypesenseResult[];
    },
    async meta() {
      return metaDocument as Record<string, unknown>;
    },
    async exportDocuments() {
      throw new Error('the page never exports');
    },
  };
  return { client, asked };
}

async function search(fixture: Fixture, ...more: Fixture[]) {
  const { client, asked } = recorded(fixture, ...more);
  const result = await runSearch(parseQuery(new URLSearchParams(fixture.search)), client);
  expect(result.status).toBe('ok');
  return { result: result as SearchOk, asked };
}

describe('recorded responses (task 10)', () => {
  it('reads the default view: 67,384 retractions, with every filter counted', async () => {
    const { result, asked } = await search(defaultView as Fixture);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toEqual(toTypesense(parseQuery(new URLSearchParams(''))).searches);
    expect(result).toMatchObject({ found: 67384, totals: { Retraction: 67384 }, page: 1, pageCount: 3370, closeSpellings: false });
    expect(result.records).toHaveLength(20);
    // Notice types are counted without the retractions-only default (AC2).
    expect(result.counts.notice_type.map((entry) => entry.value).sort()).toEqual([
      'Correction',
      'Expression of concern',
      'Reinstatement',
      'Retraction',
    ]);
    // So are revised versions.
    expect(result.counts.is_revision.find((entry) => entry.value === 'true')?.count).toBeGreaterThan(0);
    for (const field of ['reasons', 'subjects', 'subject_categories', 'countries', 'article_types', 'paywalled', 'notice_year', 'paper_year']) {
      expect(result.counts[field].length, field).toBeGreaterThan(0);
    }
    // 110 of the 112 reasons occur among retractions without revised versions.
    expect(result.counts.reasons).toHaveLength(110);
    expect(result.counts.journal).toHaveLength(40);
    expect(result.counts.publisher).toHaveLength(40);
  });

  it('reads every field of a record', async () => {
    const { result } = await search(defaultView as Fixture);
    const record = result.records[0];
    expect(record).toMatchObject({ noticeType: 'Retraction', isRevision: false });
    expect(typeof record.recordId).toBe('number');
    expect(typeof record.noticeDate).toBe('number');
    expect(record.urls).toHaveLength(record.urlRecordCounts.length);
    expect(record.titleSegments).toEqual([{ text: record.title, mark: false }]);
    expect(record.matchedAuthors).toEqual([]);
  });

  it('turns highlights into text and marks, without HTML (AC13)', async () => {
    const { result } = await search(text as Fixture);
    expect(result.closeSpellings).toBe(false);
    const record = result.records[0];
    const titleMarks = record.titleSegments.filter((segment) => segment.mark).map((segment) => segment.text.toLowerCase());
    expect(titleMarks).toContain('cancer');
    expect(record.titleSegments.map((segment) => segment.text).join('')).toBe(record.title);
    expect(record.matchedAuthors).toEqual(record.authors.map((author, index) => (author === 'Unknown' ? index : -1)).filter((index) => index > -1));
    for (const [index, parts] of record.authorSegments.entries()) {
      expect(parts.map((segment) => segment.text).join('')).toBe(record.authors[index]);
    }
  });

  it('asks again with typos on when only close spellings matched, so counts agree (AC13)', async () => {
    const { result, asked } = await search(closeFirst as Fixture, closeSecond as Fixture);
    expect(asked).toHaveLength(2);
    expect(asked[1]).toEqual(toTypesense(parseQuery(new URLSearchParams('q=iraq&country=Serbia')), { typos: 'always' }).searches);
    expect(result.closeSpellings).toBe(true);
    expect(result.found).toBeGreaterThan(0);
    // With typos on everywhere, the selected country's count equals the results.
    expect(result.counts.countries.find((entry) => entry.value === 'Serbia')?.count).toBe(result.found);
  });

  it('shows full names for cut journal values, and counts selected journals outside the top 40 (AC6)', async () => {
    const { result } = await search(journalsSelected as Fixture);
    const query = parseQuery(new URLSearchParams((journalsSelected as Fixture).search));
    const [longName, missing] = query.filters.journal.include;
    expect(new TextEncoder().encode(longName).length).toBeGreaterThan(255);
    const counts = new Map(result.counts.journal.map((entry) => [entry.value, entry.count]));
    expect(counts.get(longName)).toBeGreaterThan(0);
    expect(counts.get(missing)).toBe(0);
    expect(counts.has('medRxiv')).toBe(true);
    // No value is left cut short.
    const cut = Object.keys((metaDocument as { cut_names: { journal: Record<string, string> } }).cut_names.journal);
    expect(result.counts.journal.some((entry) => cut.includes(entry.value))).toBe(false);
    expect(result.records.every((record) => record.journal === longName)).toBe(true);
  });
});

describe('meta', () => {
  it('reads the data date, commit and cut names', async () => {
    const { client } = recorded();
    const meta = await loadMeta(client);
    expect(meta).toMatchObject({ dataDate: '2026-10-09', commit: 'bc5648dd', documents: 73100 });
    expect(Object.keys(meta!.cutNames.journal)).toHaveLength(69);
    expect(Object.keys(meta!.cutNames.publisher)).toHaveLength(66);
  });
});

describe('failures (AC29)', () => {
  const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});

  it('says search is unavailable when Typesense can’t be reached', async () => {
    const log = quiet();
    const client: TypesenseClient = {
      multiSearch: async () => {
        throw new SearchUnavailableError("Typesense can't be reached");
      },
      exportDocuments: async () => {
        throw new SearchUnavailableError("Typesense can't be reached");
      },
      meta: async () => {
        throw new SearchUnavailableError("Typesense can't be reached");
      },
    };
    expect(await runSearch(parseQuery(new URLSearchParams('')), client)).toEqual({ status: 'unavailable' });
    expect(await loadMeta(client)).toBeNull();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('says search is unavailable when Typesense refuses a search', async () => {
    const log = quiet();
    const { client } = recorded({ search: '', typos: 'fallback', results: [{ code: 404, error: 'Not found.' }] });
    expect(await runSearch(parseQuery(new URLSearchParams('')), client)).toEqual({ status: 'unavailable' });
    log.mockRestore();
  });

  it('fails safely without keys in the environment', async () => {
    const log = quiet();
    const saved = { url: process.env.TYPESENSE_URL, key: process.env.TYPESENSE_SEARCH_KEY };
    delete process.env.TYPESENSE_URL;
    delete process.env.TYPESENSE_SEARCH_KEY;
    expect(await runSearch(parseQuery(new URLSearchParams('')))).toEqual({ status: 'unavailable' });
    Object.assign(process.env, saved.url ? { TYPESENSE_URL: saved.url } : {}, saved.key ? { TYPESENSE_SEARCH_KEY: saved.key } : {});
    log.mockRestore();
  });
});

describe('segments', () => {
  it('splits marked text and keeps HTML as text', () => {
    expect(segments('a <b>cancer</b> & cell')).toEqual([
      { text: 'a ', mark: false },
      { text: '<b>cancer</b>', mark: true },
      { text: ' & ', mark: false },
      { text: 'cell', mark: true },
    ]);
    expect(segments('')).toEqual([]);
  });
});

describe('value search (AC6)', () => {
  it('returns found values with full names for cut ones', async () => {
    const cut = Object.entries((metaDocument as { cut_names: { journal: Record<string, string> } }).cut_names.journal)[0];
    const { client, asked } = recorded({
      search: '',
      typos: 'fallback',
      results: [
        { found: 10, facet_counts: [{ field_name: 'journal', counts: [{ value: cut[0], count: 3 }, { value: 'medRxiv', count: 2 }] }] },
        { found: 1, facet_counts: [{ field_name: 'journal', counts: [{ value: 'Med', count: 1 }] }] },
      ],
    });
    const result = await runFacetValueSearch(parseQuery(new URLSearchParams('')), 'journal', 'med', client);
    // The journal named exactly as typed comes first.
    expect(result).toEqual({
      status: 'ok',
      values: [
        { value: 'Med', count: 1 },
        { value: cut[1], count: 3 },
        { value: 'medRxiv', count: 2 },
      ],
    });
    expect(asked[0][0].facet_query).toBe('journal:med');
    expect(asked[0][1].filter_by).toBe('notice_type:=[`Retraction`] && is_revision:=false && journal:=[`med`]');
  });

  it('says the search is unavailable when Typesense is', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client: TypesenseClient = {
      multiSearch: async () => {
        throw new SearchUnavailableError('down');
      },
      exportDocuments: async () => {
        throw new SearchUnavailableError('down');
      },
      meta: async () => metaDocument as Record<string, unknown>,
    };
    expect(await runFacetValueSearch(parseQuery(new URLSearchParams('')), 'publisher', 'spring', client)).toEqual({ status: 'unavailable' });
    log.mockRestore();
  });
});
