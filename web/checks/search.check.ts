// npm run check:search (spec 002 task 21): runs a fixed set of searches through
// the site's own server code against the local Typesense, and compares totals,
// every filter count and search behavior with DuckDB on the same snapshot.
// Needs `npm run search:up` and `npm run load` first, or --server-env with
// another server's env file and its snapshot cleaned here (spec 004 task 7).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LONG_FACET_LIMIT, SMALL_FACET_LIMIT } from '../lib/query/typesense';
import { parseQuery } from '../lib/query/url';
import type { Query } from '../lib/query/types';
import { COLUMNS as CSV_COLUMNS } from '../lib/search/csv';
import type { Meta, SearchOk } from '../lib/search/types';
import { startExport } from '../lib/server/export';
import { loadMeta, runSearch } from '../lib/server/search';
import { conditions, countsWithoutOwnSetting, fieldCounts, openSnapshot, PART_FIELDS, sql, where, type Part, type Snapshot } from './snapshot';

let meta: Meta;
let snapshot: Snapshot;

beforeAll(async () => {
  const loaded = await loadMeta();
  if (!loaded) {
    throw new Error('Typesense has no data or can\'t be reached. Locally, run npm run search:up, then npm run load.');
  }
  meta = loaded;
  snapshot = await openSnapshot(meta);
});

afterAll(() => snapshot?.close());

const toQuery = (search: string) => parseQuery(new URLSearchParams(search));

async function search(query: Query): Promise<SearchOk> {
  const result = await runSearch(query);
  if (result.status !== 'ok') {
    throw new Error('Search is unavailable. Is the search server running?');
  }
  return result;
}

async function count(conditionList: string[]): Promise<number> {
  const [row] = await snapshot.rows<{ count: number }>(`SELECT count(*)::INTEGER AS count FROM docs WHERE ${where(conditionList)}`);
  return row.count;
}

// Every difference between the page's total, totals by notice type and filter
// counts, and DuckDB's (AC4, AC6, AC17, AC30).
async function countDifferences(query: Query): Promise<string[]> {
  const result = await search(query);
  const parts = conditions(query);
  const all = [...parts.values()];
  const differences: string[] = [];

  const found = await count(all);
  if (result.found !== found) {
    differences.push(`total: site ${result.found}, DuckDB ${found}`);
  }
  const totals = await fieldCounts(snapshot, 'notice_type', all);
  for (const [type, expected] of totals) {
    if ((result.totals[type] ?? 0) !== expected) {
      differences.push(`total of ${type}: site ${result.totals[type] ?? 0}, DuckDB ${expected}`);
    }
  }

  for (const [part, fields] of Object.entries(PART_FIELDS) as [Part, string[]][]) {
    const without = countsWithoutOwnSetting(query, part) ? [...parts].filter(([key]) => key !== part).map(([, condition]) => condition) : all;
    for (const field of fields) {
      const shown = result.counts[field] ?? [];
      const expected = await fieldCounts(snapshot, field, without);
      for (const { value, count: siteCount } of shown) {
        if ((expected.get(value) ?? 0) !== siteCount) {
          differences.push(`${field} "${value}": site ${siteCount}, DuckDB ${expected.get(value) ?? 0}`);
        }
      }
      const shownValues = new Set(shown.map(({ value }) => value));
      const missing = [...expected].filter(([value, expectedCount]) => expectedCount > 0 && !shownValues.has(value));
      const limit = field === 'journal' || field === 'publisher' ? LONG_FACET_LIMIT : SMALL_FACET_LIMIT;
      if (expected.size <= limit) {
        // Every value with records is shown.
        for (const [value, expectedCount] of missing) {
          differences.push(`${field} "${value}": missing, DuckDB ${expectedCount}`);
        }
      } else {
        // Long filters show their top values: nothing left out has more records than a value shown.
        // Selected values are shown whatever their count, so they don't count as top values.
        const selection = query.filters[field as 'journal' | 'publisher'];
        const selected = new Set([...selection.include, ...selection.exclude]);
        const smallestShown = Math.min(...shown.filter(({ value }) => !selected.has(value)).map(({ count: c }) => c));
        const biggestLeftOut = Math.max(0, ...missing.map(([, c]) => c));
        if (biggestLeftOut > smallestShown) {
          differences.push(`${field}: a value left out has ${biggestLeftOut} records, more than the smallest shown (${smallestShown})`);
        }
      }
    }
  }
  return differences;
}

// The biggest values of a field, for the longest filter lists.
async function topValues(field: string, limit: number): Promise<string[]> {
  const counts = await fieldCounts(snapshot, field, []);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([value]) => value);
}

// The record IDs in a search's CSV download, which holds every result.
async function downloadedIds(query: Query): Promise<Set<number>> {
  const download = await startExport(query, 'https://example.org');
  if (download.status !== 'ok') {
    throw new Error('The download is unavailable.');
  }
  const rows = parseCsv(new TextDecoder().decode(await new Response(download.body).arrayBuffer()));
  return new Set(rows.slice(1).map((cells) => Number(cells[0])));
}

const repeat = (key: string, values: string[]) => values.map((value) => `${key}=${encodeURIComponent(value)}`).join('&');

describe('totals and every filter count match DuckDB (AC4, AC6, AC8, AC30)', () => {
  const cases: [string, () => Promise<string> | string][] = [
    ['the default view', () => ''],
    ['every record', () => 'type=all&revisions=include'],
    [
      'any of two reasons, a country excluded and a notice-year range',
      () => 'reason=Investigation+by+Journal%2FPublisher&reason=Concerns%2FIssues+about+Data&not_country=China&notice_from=2015&notice_to=2020',
    ],
    ['all of two reasons', () => 'reason=Investigation+by+Journal%2FPublisher&reason=Concerns%2FIssues+about+Data&reason_match=all'],
    ['two notice types, without editorial-staff notices', () => 'type=Expression+of+concern&type=Correction&editorial_staff=exclude'],
    ['a subject group minus one of its subjects', () => 'subject=BLS&not_subject=BLS%3A+Biology+-+Cellular'],
    ['all of two subjects in different groups', () => 'subject=BLS%3A+Biology+-+Cellular&subject=B%2FT%3A+Technology&subject_match=all'],
    ['two countries excluded and one article type', () => 'not_country=China&not_country=United+States&article_type=Research+Article'],
    ['all of two article types', () => 'article_type=Research+Article&article_type=Clinical+Study&article_type_match=all&type=all'],
    ['paper years before 1970, every type', () => 'type=all&revisions=include&paper_to=1969'],
    ['notice years before 1970, every type', () => 'type=all&revisions=include&notice_to=1969'],
    ['paywalled notices of every type', () => 'type=all&paywalled=Yes'],
    ['notices not paywalled, revised versions included', () => 'not_paywalled=No&revisions=include'],
    ['the 50 biggest journals (the longest list)', async () => repeat('journal', await topValues('journal', 50))],
    ['the 50 biggest countries, every type', async () => `type=all&${repeat('country', await topValues('countries', 50))}`],
    ['three publishers included and the biggest journal excluded', async () => `${repeat('publisher', await topValues('publisher', 3))}&${repeat('not_journal', await topValues('journal', 1))}`],
    ['the five biggest publishers excluded', async () => repeat('not_publisher', await topValues('publisher', 5))],
  ];
  for (const [name, build] of cases) {
    it(name, async () => {
      expect(await countDifferences(toQuery(await build()))).toEqual([]);
    });
  }
});

describe('search behavior on real data (AC8, AC12, AC13, AC14, AC20, AC23)', () => {
  it('pages to the last page of the default view, which ends with the oldest notice (AC20)', async () => {
    const first = await search(toQuery(''));
    const last = await search(toQuery(`page=${first.pageCount}`));
    expect(last.records.length).toBe(first.found - (first.pageCount - 1) * first.perPage);
    const parts = [...conditions(toQuery('')).values()];
    const [oldest] = await snapshot.rows<{ record_id: number }>(
      `SELECT record_id::INTEGER AS record_id FROM docs WHERE ${where(parts)} ORDER BY notice_date ASC, record_id ASC LIMIT 1`,
    );
    expect(last.records.at(-1)?.recordId).toBe(oldest.record_id);
    expect((await search(toQuery(`page=${first.pageCount + 1}`))).records).toEqual([]);
  });

  it('sorts papers from before 1970 first, as DuckDB does (AC8)', async () => {
    const result = await search(toQuery('type=all&revisions=include&sort=paper_oldest'));
    const expected = await snapshot.rows<{ record_id: number }>(
      'SELECT record_id::INTEGER AS record_id FROM docs ORDER BY paper_date ASC, record_id ASC LIMIT 20',
    );
    expect(result.records.map((record) => record.recordId)).toEqual(expected.map((row) => row.record_id));
  });

  // Spike S6: near-identical names stay apart while a search has exact matches (AC13).
  const NAME_PAIRS = [
    ['Toronto', 'Torino'],
    ['Hunan', 'Henan'],
    ['Hubei', 'Hebei'],
    ['Iran', 'Iraq'],
    ['Shaanxi', 'Shanxi'],
    ['Suzhou', 'Xuzhou'],
    ['Nanjing', 'Nanning'],
    ['Boston', 'Houston'],
    ['Neurology', 'Urology'],
    ['Cardiology', 'Radiology'],
    ['Austria', 'Australia'],
    ['Finance', 'France'],
  ];
  const words = NAME_PAIRS.flatMap(([a, b]) => [
    [a, b],
    [b, a],
  ]);
  it.each(words)('finds "%s" without "%s" (AC13)', async (word, other) => {
    const query = toQuery(`q=${word}`);
    const result = await search(query);
    expect(result.closeSpellings).toBe(false);
    const ids = await downloadedIds(query);
    expect(ids.size).toBe(result.found);
    const parts = [...conditions(toQuery('')).values()];
    const matching = async (test: string) =>
      new Set(
        (
          await snapshot.rows<{ id: number }>(
            `SELECT docs.record_id::INTEGER AS id FROM docs JOIN search_words USING (record_id) WHERE ${where([...parts, test])}`,
          )
        ).map((row) => row.id),
      );
    const target = sql(word.toLowerCase());
    // Every record with the word itself is found…
    const exact = await matching(`list_contains(words, ${target})`);
    // …and every result has a word that starts with it: none came from the other spelling.
    const prefixed = await matching(`len(list_filter(words, lambda w: starts_with(w, ${target}))) > 0`);
    expect([...exact].filter((id) => !ids.has(id)), `records with "${word}" not found`).toEqual([]);
    expect([...ids].filter((id) => !prefixed.has(id)), `results without "${word}", perhaps from "${other}"`).toEqual([]);
  });

  it('says when it shows close spellings, with counts that agree with the results (AC13)', async () => {
    const query = toQuery('q=nuerons');
    const result = await search(query);
    expect(result.closeSpellings).toBe(true);
    expect(result.found).toBeGreaterThan(0);
    expect(Object.values(result.totals).reduce((sum, value) => sum + value, 0)).toBe(result.found);
    const download = await startExport(query, 'https://example.org');
    expect(download.status === 'ok' && download.total).toBe(result.found);
  });

  it('looks up a DOI and a PubMed ID whatever the filters, in any case (AC12)', async () => {
    const [row] = await snapshot.rows<{ doi: string; pubmed: number; type: string }>(
      `SELECT notice_doi AS doi, notice_pubmed_id::INTEGER AS pubmed, notice_type AS type FROM docs
       WHERE notice_type = 'Expression of concern' AND notice_doi IS NOT NULL AND notice_pubmed_id IS NOT NULL ORDER BY record_id LIMIT 1`,
    );
    const byDoi = await count([`(notice_doi = ${sql(row.doi)} OR paper_doi = ${sql(row.doi)})`]);
    const byPubmed = await count([`(notice_pubmed_id = ${row.pubmed} OR paper_pubmed_id = ${row.pubmed})`]);
    for (const q of [row.doi, row.doi.toUpperCase(), `https://doi.org/${row.doi}`]) {
      const result = await search(toQuery(`q=${encodeURIComponent(q)}&reason=Manipulation+of+Images`));
      expect(result.lookup?.kind).toBe('doi');
      expect(result.found).toBe(byDoi);
    }
    const result = await search(toQuery(`q=${row.pubmed}`));
    expect(result.lookup?.kind).toBe('pubmed');
    expect(result.found).toBe(byPubmed);
  });

  it('matches author names ignoring capitals and accents (AC14)', async () => {
    // Groups of names that differ only in Latin capitals or accents, chosen from
    // the data so that no real name is written in this file. Typesense doesn't
    // fold the capitals of other scripts: 3 groups on the 2026-10-09 snapshot
    // differ only in Cyrillic capitals and stay apart (plan 002, "Pages").
    const groups = await snapshot.rows<{ names: string[] }>(
      `SELECT list(DISTINCT name ORDER BY name) AS names FROM (SELECT unnest(authors) AS name FROM docs)
       GROUP BY lower(strip_accents(name))
       HAVING count(DISTINCT name) > 1
         AND count(DISTINCT translate(strip_accents(name), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')) = 1
       ORDER BY lower(strip_accents(name)) LIMIT 10`,
    );
    expect(groups.length).toBe(10);
    for (const { names } of groups) {
      const expected = await count([`list_contains(list_transform(authors, lambda a: name_key(a)), name_key(${sql(names[0])}))`]);
      for (const name of names) {
        const result = await search(toQuery(`type=all&revisions=include&author_name=${encodeURIComponent(name)}`));
        expect(result.found, `one of ${names.length} spellings`).toBe(expected);
      }
    }
  });

  it('filters on each journal spelling the cleaning merged (AC30)', async () => {
    const merged = await snapshot.rows<{ journal: string }>(
      `SELECT DISTINCT journal FROM docs WHERE original.journal IS NOT NULL AND original.journal <> journal
       AND lower(strip_accents(original.journal)) = lower(strip_accents(journal)) ORDER BY journal`,
    );
    expect(merged.length).toBeGreaterThan(0);
    for (const { journal } of merged) {
      const query = toQuery(`type=all&revisions=include&journal=${encodeURIComponent(journal)}`);
      expect(await countDifferences(query), journal).toEqual([]);
    }
  });

  it.each([
    ['filters only', 'reason=Manipulation+of+Images&notice_from=2020'],
    ['search text', 'q=neuron&type=all'],
  ])('downloads the same records as the page, with list fields that split back (%s, AC23)', async (_, searchText) => {
    const query = toQuery(searchText);
    const result = await search(query);
    const download = await startExport(query, 'https://example.org');
    if (download.status !== 'ok') {
      throw new Error('The download is unavailable.');
    }
    const rows = parseCsv(new TextDecoder().decode(await new Response(download.body).arrayBuffer()));
    const [header, ...records] = rows;
    expect(header).toEqual(CSV_COLUMNS.map(([name]) => name));
    expect(records.length).toBe(result.found);
    const column = (name: string) => header.indexOf(name);
    const ids = records.map((cells) => Number(cells[column('record_id')]));
    expect(new Set(ids).size).toBe(ids.length);

    const expected = await snapshot.rows<{ record_id: number; authors: string[]; reasons: string[]; countries: string[]; urls: string[] | null }>(
      `SELECT record_id::INTEGER AS record_id, authors, reasons, countries, urls FROM docs WHERE record_id IN (${ids.join(', ')})`,
    );
    expect(expected.length).toBe(ids.length);
    const byId = new Map(expected.map((row) => [row.record_id, row]));
    const split = (cell: string) => (cell === '' ? [] : cell.split(';').map((entry) => entry.trim()));
    for (const cells of records) {
      const doc = byId.get(Number(cells[column('record_id')]))!;
      expect(split(cells[column('author_names')])).toEqual(doc.authors ?? []);
      expect(split(cells[column('reasons')])).toEqual(doc.reasons ?? []);
      expect(split(cells[column('countries')])).toEqual(doc.countries ?? []);
      expect(split(cells[column('retraction_watch_links')])).toEqual(doc.urls ?? []);
    }
    if (!query.q) {
      expect(ids.sort((a, b) => a - b)).toEqual(
        (await snapshot.rows<{ id: number }>(`SELECT record_id::INTEGER AS id FROM docs WHERE ${where([...conditions(query).values()])} ORDER BY id`)).map(
          (row) => row.id,
        ),
      );
    }
  });
});

// RFC 4180, as the download writes it: quoted cells may hold commas, quotes and line breaks.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const input = text.replace(/^﻿/, '');
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\r' && input[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else {
      cell += char;
    }
  }
  return rows;
}
