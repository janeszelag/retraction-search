import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildDocuments, cleanRecords, documentLines, loadSource } from '../src/clean.js';
import { openDatabase } from '../src/duckdb.js';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

// Fields every document has, and fields that are left out when missing.
const REQUIRED = {
  id: 'string',
  record_id: 'number',
  title: 'string',
  authors: 'array',
  institutions: 'array',
  journal: 'string',
  publisher: 'string',
  countries: 'array',
  subject_categories: 'array',
  subjects: 'array',
  article_types: 'array',
  reasons: 'array',
  notice_type: 'string',
  paywalled: 'string',
  is_revision: 'boolean',
  has_editorial_staff_author: 'boolean',
  notice_date: 'number',
  notice_year: 'number',
  paper_date: 'number',
  paper_year: 'number',
  urls: 'array',
  original: 'object',
};
const OPTIONAL = {
  notice_doi: 'string',
  notice_pubmed_id: 'number',
  paper_doi: 'string',
  paper_pubmed_id: 'number',
  notes: 'string',
};

const typeOf = (value) => (Array.isArray(value) ? 'array' : typeof value);

function containsNull(value) {
  if (value === null) {
    return true;
  }
  if (typeof value === 'object') {
    return Object.values(value).some(containsNull);
  }
  return false;
}

let lines;
let documents;

beforeAll(async () => {
  const db = await openDatabase();
  await loadSource(db, fixture('sample.csv'));
  await cleanRecords(db);
  await buildDocuments(db);
  lines = await documentLines(db);
  documents = new Map(lines.map((line) => JSON.parse(line)).map((doc) => [doc.record_id, doc]));
});

describe('search documents (AC13)', () => {
  it('writes one document per record, in record ID order', () => {
    const ids = lines.map((line) => JSON.parse(line).record_id);
    expect(ids).toHaveLength(37);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('gives every document the expected fields and types', () => {
    for (const doc of documents.values()) {
      for (const [field, type] of Object.entries(REQUIRED)) {
        expect(typeOf(doc[field]), `${field} in record ${doc.id}`).toBe(type);
      }
      for (const [field, value] of Object.entries(doc)) {
        const type = REQUIRED[field] ?? OPTIONAL[field];
        expect(type, `unexpected field ${field} in record ${doc.id}`).toBeDefined();
        expect(typeOf(value), `${field} in record ${doc.id}`).toBe(type);
      }
      expect(doc.id).toBe(String(doc.record_id));
    }
  });

  it('leaves missing values out instead of writing null', () => {
    for (const doc of documents.values()) {
      expect(containsNull(doc), `null in record ${doc.id}`).toBe(false);
    }
    expect(documents.get(17)).not.toHaveProperty('paper_doi');
    expect(documents.get(96)).not.toHaveProperty('notice_doi');
    expect(documents.get(1086)).not.toHaveProperty('paper_pubmed_id');
  });

  it('stores dates as Unix seconds, negative before 1970', () => {
    expect(documents.get(2).notice_date).toBe(Date.UTC(2015, 0, 29) / 1000);
    expect(documents.get(18930).notice_date).toBe(Date.UTC(1756, 5, 24) / 1000);
    expect(documents.get(18930).paper_date).toBe(Date.UTC(1753, 0, 1) / 1000);
    expect(documents.get(18930).paper_year).toBe(1753);
  });

  it('keeps each subject with its code, and lists each category once', () => {
    expect(documents.get(35).subject_categories).toEqual(['BLS', 'HSC']);
    expect(documents.get(35).subjects).toEqual([
      'BLS: Biology - Cellular',
      'BLS: Nutrition',
      'HSC: Medicine - Cardiovascular',
      'HSC: Medicine - Diabetes',
    ]);
  });

  it('has a field for every filter in Goal 1', () => {
    const doc = documents.get(2);
    for (const field of ['reasons', 'subject_categories', 'subjects', 'notice_type', 'countries', 'publisher', 'notice_year', 'paper_year', 'paywalled']) {
      expect(doc, field).toHaveProperty(field);
    }
  });

  it('keeps the original values for record pages', () => {
    // Record 18930's institution was the placeholder "unavailable", so its source text is kept too.
    expect(documents.get(18930).institutions).toEqual(['Unknown']);
    expect(documents.get(18930).original).toEqual({
      notice_date: '6/24/1756 0:00',
      notice_doi: '10.1098/rstl.1755.0107',
      notice_pubmed_id: '0',
      paper_date: '1/1/1753 0:00',
      paper_doi: 'unavailable',
      paper_pubmed_id: '0',
      institution: 'unavailable',
    });
  });
});
