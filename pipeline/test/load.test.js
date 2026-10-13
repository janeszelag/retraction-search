import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildDocuments, cleanRecords, documentLines, loadSource } from '../src/clean.js';
import { openDatabase } from '../src/duckdb.js';
import {
  ImportError,
  collectionName,
  collectionSchema,
  collectionsToDelete,
  describeSnapshotDir,
  readImportResults,
  withEnvValue,
} from '../src/load.js';

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
