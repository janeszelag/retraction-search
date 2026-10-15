import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDocuments, cleanRecords, documentLines, loadSource, runCleaning } from '../src/clean.js';
import { openDatabase } from '../src/duckdb.js';
import {
  DocumentCheckError,
  ImportError,
  ValueCheckError,
  canonicalJson,
  checkValues,
  cleanUp,
  collectionName,
  collectionSchema,
  collectionsToDelete,
  cutFacetValue,
  cutNames,
  describeSnapshotDir,
  differingFields,
  escapeNonAscii,
  importSnapshot,
  readImportResults,
  readMeta,
  switchTo,
  unexpectedFacetValues,
  valuesDifferingInCaseOrAccents,
  withEnvValue,
} from '../src/load.js';
import { fakeTypesense } from './helpers/fake-typesense.js';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const fits = {
  string: (value) => typeof value === 'string',
  'string[]': (value) => Array.isArray(value) && value.every((entry) => typeof entry === 'string'),
  bool: (value) => typeof value === 'boolean',
  int32: (value) => Number.isInteger(value) && value >= -(2 ** 31) && value < 2 ** 31,
  int64: (value) => Number.isSafeInteger(value),
};

let documents;

beforeAll(async () => {
  const db = await openDatabase();
  await loadSource(db, fixture('sample.csv'));
  await cleanRecords(db);
  await buildDocuments(db);
  documents = (await documentLines(db)).map((line) => JSON.parse(line));
});

describe('collection schema', () => {
  const schema = collectionSchema('retractions_test');

  it('fits every fixture document', () => {
    for (const doc of documents) {
      for (const field of schema.fields) {
        if (!(field.name in doc)) {
          expect(field.optional, `${field.name} missing from record ${doc.id}`).toBe(true);
          continue;
        }
        expect(fits[field.type](doc[field.name]), `${field.name} in record ${doc.id}`).toBe(true);
      }
    }
  });

  it('indexes every document field except the ones only shown on pages', () => {
    const indexed = new Set(schema.fields.map((field) => field.name));
    const fields = new Set(documents.flatMap((doc) => Object.keys(doc)));
    const notIndexed = [...fields].filter((field) => !indexed.has(field)).sort();
    expect(notIndexed).toEqual(['id', 'notes', 'original', 'url_record_counts', 'urls']);
  });

  it('makes every filter field a facet, and nothing else', () => {
    const facets = schema.fields.filter((field) => field.facet).map((field) => field.name).sort();
    expect(facets).toEqual([
      'article_types',
      'countries',
      'has_editorial_staff_author',
      'is_revision',
      'journal',
      'notice_type',
      'notice_year',
      'paper_year',
      'paywalled',
      'publisher',
      'reasons',
      'subject_categories',
      'subjects',
    ]);
  });

  it('splits words at hyphens and slashes in searched text, but not in names or filter lists', () => {
    const split = schema.fields.filter((field) => field.token_separators).map((field) => field.name);
    expect(split).toEqual(['title', 'institutions', 'journal', 'publisher']);
    expect(schema.fields.find((field) => field.name === 'title').token_separators).toEqual(['-', '/']);
  });

  it('makes only the identifiers optional', () => {
    const optional = schema.fields.filter((field) => field.optional).map((field) => field.name).sort();
    expect(optional).toEqual(['notice_doi', 'notice_pubmed_id', 'paper_doi', 'paper_pubmed_id']);
  });
});

describe('collection names', () => {
  it('reads the data date and commit from the folder name', () => {
    expect(describeSnapshotDir('/repo/data/clean/2026-10-09-bc5648dd')).toEqual({
      dataDate: '2026-10-09',
      commit: 'bc5648dd',
    });
    expect(() => describeSnapshotDir('/tmp/somewhere')).toThrow(/isn't a cleaned snapshot folder/);
  });

  it('names a collection after the snapshot and the load time', () => {
    const snapshot = { dataDate: '2026-10-09', commit: 'bc5648dd' };
    expect(collectionName(snapshot, new Date('2026-10-13T22:30:12.345Z'))).toBe(
      'retractions_2026-10-09_bc5648dd_20261013T223012Z',
    );
  });

  it('deletes snapshot collections other than the new and previous ones', () => {
    const names = ['meta', 'retractions_a', 'retractions_b', 'retractions_c', 'other_d'];
    expect(collectionsToDelete(names, { current: 'retractions_c', previous: 'retractions_b' })).toEqual([
      'retractions_a',
    ]);
    expect(collectionsToDelete(names, { current: 'retractions_c', previous: null })).toEqual([
      'retractions_a',
      'retractions_b',
    ]);
  });
});

describe('import results', () => {
  it('counts the documents imported', () => {
    expect(readImportResults('{"success":true,"id":"1"}\n{"success":true,"id":"2"}\n', 2)).toBe(2);
  });

  it('stops on the first failed line and names the document', () => {
    const response = [
      '{"success":true,"id":"1"}',
      '{"success":false,"id":"2","error":"Field `title` must be a string.","code":400}',
      '{"success":false,"id":"3","error":"Another error"}',
    ].join('\n');
    expect(() => readImportResults(response, 3)).toThrow(ImportError);
    expect(() => readImportResults(response, 3)).toThrow('Import failed at document 2: Field `title` must be a string.');
  });

  it('fails when a result line is missing', () => {
    expect(() => readImportResults('{"success":true,"id":"1"}', 2)).toThrow('Import returned 1 results for 2 documents.');
  });
});

describe('facet values cut at 255 bytes (spike S2)', () => {
  const bytes = (value) => Buffer.byteLength(value);

  it('keeps values of up to 255 bytes whole', () => {
    expect(cutFacetValue('a'.repeat(255))).toBe('a'.repeat(255));
  });

  it('cuts longer values to 255 bytes, ending on a whole character', () => {
    expect(cutFacetValue('a'.repeat(300))).toBe('a'.repeat(255));
    // Cyrillic letters take two bytes each, so 128 of them would be 256 bytes.
    const cyrillic = 'Ж'.repeat(200);
    expect(cutFacetValue(cyrillic)).toBe('Ж'.repeat(127));
    expect(bytes(cutFacetValue(`a${cyrillic}`))).toBe(255);
  });

  it('maps each cut value to its full name', () => {
    const long = `Journal of ${'Long Names '.repeat(30)}`;
    expect(cutNames('journal', ['Short', long])).toEqual({ [cutFacetValue(long)]: long });
  });

  it('fails when two names share their first 255 bytes', () => {
    const start = 'x'.repeat(255);
    expect(() => cutNames('journal', [`${start} A`, `${start} B`])).toThrow(ValueCheckError);
    // A name that is exactly another's cut value merges too.
    expect(() => cutNames('publisher', [start, `${start} B`])).toThrow(/Two publisher values share their first 255 bytes/);
  });

  it('finds facet values the load did not expect', () => {
    const long = 'y'.repeat(300);
    const cut = cutNames('journal', ['A', long]);
    expect(unexpectedFacetValues(['A', 'y'.repeat(255)], ['A', long], cut)).toEqual([]);
    // Typesense cut differently than expected: the returned value is unknown and the expected one is missing.
    expect(unexpectedFacetValues(['A', 'y'.repeat(250)], ['A', long], cut)).toEqual(['y'.repeat(250), 'y'.repeat(255)]);
  });
});

describe('filter values that differ only in capitals or accents (spike S8)', () => {
  it('groups them', () => {
    expect(valuesDifferingInCaseOrAccents('countries', ['Peru', 'Perú', 'China', 'china', 'India'])).toEqual([
      'countries: "Peru", "Perú"',
      'countries: "China", "china"',
    ]);
    expect(valuesDifferingInCaseOrAccents('reasons', ['Error in Data', 'Error in Text'])).toEqual([]);
  });

  it('stops the load when a filter field has them', () => {
    const values = {
      journal: new Set(['J']),
      publisher: new Set(['P']),
      notice_type: new Set(['Retraction']),
      paywalled: new Set(['No']),
      reasons: new Set(['Error in Data', 'Error in data']),
      subjects: new Set(),
      subject_categories: new Set(),
      countries: new Set(['China']),
      article_types: new Set(),
    };
    expect(() => checkValues(values)).toThrow('reasons: "Error in Data", "Error in data"');
    values.reasons = new Set(['Error in Data']);
    expect(checkValues(values)).toEqual({ journal: {}, publisher: {} });
    // Journals and publishers too: the cleaning should have merged these.
    values.journal = new Set(['medRxiv', 'medrxiv']);
    expect(() => checkValues(values)).toThrow('journal: "medRxiv", "medrxiv"');
  });

  it('passes the fixture documents', () => {
    const fields = ['journal', 'publisher', 'notice_type', 'paywalled', 'reasons', 'subjects', 'subject_categories', 'countries', 'article_types'];
    const values = Object.fromEntries(fields.map((field) => [field, new Set(documents.flatMap((doc) => [doc[field]].flat()))]));
    expect(() => checkValues(values)).not.toThrow();
  });
});

describe('env file', () => {
  it('replaces an existing value and keeps the other lines', () => {
    const text = '# comment\nTYPESENSE_SEARCH_KEY=\nREDIS_URL=redis://localhost:6379\n';
    expect(withEnvValue(text, 'TYPESENSE_SEARCH_KEY', 'abc')).toBe(
      '# comment\nTYPESENSE_SEARCH_KEY=abc\nREDIS_URL=redis://localhost:6379\n',
    );
  });

  it('adds a missing value', () => {
    expect(withEnvValue('A=1', 'TYPESENSE_SEARCH_KEY', 'abc')).toBe('A=1\nTYPESENSE_SEARCH_KEY=abc\n');
    expect(withEnvValue('', 'TYPESENSE_SEARCH_KEY', 'abc')).toBe('TYPESENSE_SEARCH_KEY=abc\n');
  });
});

describe('escaped import bodies (decision record 004)', () => {
  const text = JSON.stringify({ title: 'Ж é – β “quoted” 𝔅   plain', authors: ['Ana Ñandú'] });

  it('writes every non-ASCII character as an escape', () => {
    const escaped = escapeNonAscii(text);
    expect(escaped).toMatch(/^[\x00-\x7f]*$/);
    expect(escaped).toContain('\\u0416');
  });

  it('parses back to the same values, including characters outside the Basic Multilingual Plane', () => {
    expect(JSON.parse(escapeNonAscii(text))).toEqual(JSON.parse(text));
  });

  it('leaves ASCII text alone', () => {
    expect(escapeNonAscii('{"title":"Plain text, with \\"quotes\\""}')).toBe('{"title":"Plain text, with \\"quotes\\""}');
  });
});

describe('comparing stored documents', () => {
  it('ignores the order of keys inside objects', () => {
    expect(canonicalJson({ b: 1, original: { y: 'b', x: 'a' } })).toBe(canonicalJson({ original: { x: 'a', y: 'b' }, b: 1 }));
  });

  it('names the fields that differ', () => {
    const sent = { id: '1', authors: ['Ana Example'], original: { x: 'a', y: 'b' }, title: 'T' };
    const stored = { id: '1', authors: ['Ana Exmple'], original: { y: 'b', x: 'a' }, title: 'T', extra: true };
    expect(differingFields(sent, stored)).toEqual(['authors', 'extra']);
  });
});

describe('import, switch and clean-up steps (spec 003, task 7)', () => {
  let root;
  let snapshotDir;
  let documentLinesOfFixture;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'retraction-search-load-'));
    snapshotDir = path.join(root, '2026-10-14-bbbbbbbb');
    await runCleaning({ inputPath: fixture('sample.csv'), outputDir: snapshotDir });
    documentLinesOfFixture = (await readFile(path.join(snapshotDir, 'search-documents.jsonl'), 'utf8')).trim().split('\n');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const quiet = () => {};
  const at = (iso) => new Date(iso);

  it('imports pure-ASCII bodies and keeps a collection whose documents all match', async () => {
    const typesense = fakeTypesense();
    const imported = await importSnapshot({ snapshotDir, request: typesense.request, log: quiet, now: at('2026-10-15T01:17:00Z') });
    expect(imported).toMatchObject({
      collection: 'retractions_2026-10-14_bbbbbbbb_20261015T011700Z',
      documents: 37,
      snapshot: { dataDate: '2026-10-14', commit: 'bbbbbbbb' },
    });
    expect(typesense.importBodies.length).toBeGreaterThan(0);
    expect(typesense.importBodies.every((body) => /^[\x00-\x7f]*$/.test(body))).toBe(true);
    expect(documentLinesOfFixture.some((line) => /[^\x00-\x7f]/.test(line))).toBe(true);
    expect(typesense.requests).toContain(`GET /collections/${imported.collection}/documents/export`);
    expect([...typesense.collections.keys()]).toEqual([imported.collection]);
  });

  it('fails when Typesense drops a letter, names the record and field but not the text, and deletes the collection', async () => {
    const typesense = fakeTypesense();
    const damaged = JSON.parse(documentLinesOfFixture.find((line) => JSON.parse(line).authors.length > 1));
    const name = damaged.authors[1];
    typesense.onImport = (doc) =>
      doc.id === damaged.id ? { ...doc, authors: doc.authors.map((author, i) => (i === 1 ? author.slice(0, 2) + author.slice(3) : author)) } : doc;

    const error = await importSnapshot({ snapshotDir, request: typesense.request, log: quiet }).catch((caught) => caught);
    expect(error).toBeInstanceOf(DocumentCheckError);
    expect(error).toBeInstanceOf(ValueCheckError);
    expect(error.message).toContain(`1 stored differently from the cleaned file: record ${damaged.id} (authors)`);
    expect(error.message).not.toContain(name);
    expect(error.message).not.toContain(name.slice(0, 2) + name.slice(3));
    expect(typesense.collections.size).toBe(0);
  });

  it('fails when a document is missing or unexpected', async () => {
    const typesense = fakeTypesense();
    typesense.onImport = (doc) => (doc.id === '2' ? { ...doc, id: '999999999' } : doc);
    await expect(importSnapshot({ snapshotDir, request: typesense.request, log: quiet })).rejects.toThrow(
      /1 missing: record 2; 1 not in the cleaned file: record 999999999/,
    );
  });

  it('switches the alias, writes the meta document with the upstream commit, and returns what was there before', async () => {
    const typesense = fakeTypesense();
    const first = await importSnapshot({ snapshotDir, request: typesense.request, log: quiet, now: at('2026-10-14T01:17:00Z') });
    const firstSwitch = await switchTo({ request: typesense.request, imported: first, upstreamCommit: 'b'.repeat(40), now: at('2026-10-14T01:18:00Z'), log: quiet });
    expect(firstSwitch.previous).toBeNull();
    expect(firstSwitch.previousMeta).toBeNull();
    expect(await readMeta(typesense.request)).toEqual({
      data_date: '2026-10-14',
      commit: 'bbbbbbbb',
      upstream_commit: 'b'.repeat(40),
      collection: first.collection,
      documents: 37,
      loaded_at: '2026-10-14T01:18:00.000Z',
      cut_names: { journal: {}, publisher: {} },
    });

    const second = await importSnapshot({ snapshotDir, request: typesense.request, log: quiet, now: at('2026-10-15T01:17:00Z') });
    const secondSwitch = await switchTo({ request: typesense.request, imported: second, upstreamCommit: 'b'.repeat(40), now: at('2026-10-15T01:18:00Z'), log: quiet });
    expect(secondSwitch.previous).toBe(first.collection);
    expect(secondSwitch.previousMeta).toEqual(firstSwitch.meta);
    expect(typesense.aliases.get('retractions')).toBe(second.collection);
  });

  it('cleans up collections older than the previous one', async () => {
    const typesense = fakeTypesense();
    const names = [];
    for (const day of ['12', '13', '14']) {
      const imported = await importSnapshot({ snapshotDir, request: typesense.request, log: quiet, now: at(`2026-10-${day}T01:17:00Z`) });
      names.push(imported.collection);
    }
    expect(await cleanUp({ request: typesense.request, current: names[2], previous: names[1], log: quiet })).toEqual([names[0]]);
    expect([...typesense.collections.keys()].sort()).toEqual([names[1], names[2]].sort());
  });

  it('makes no request to /keys in the three steps (AC18)', async () => {
    const typesense = fakeTypesense();
    const imported = await importSnapshot({ snapshotDir, request: typesense.request, log: quiet });
    const { previous } = await switchTo({ request: typesense.request, imported, log: quiet });
    await cleanUp({ request: typesense.request, current: imported.collection, previous, log: quiet });
    expect(typesense.requests.filter((line) => line.includes('/keys'))).toEqual([]);
  });
});
