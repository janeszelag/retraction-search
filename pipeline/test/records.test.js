import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { cleanRecords, loadSource } from '../src/clean.js';
import { openDatabase, queryRows } from '../src/duckdb.js';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

let db;

async function record(id, columns) {
  const [row] = await queryRows(db, `SELECT ${columns} FROM records WHERE record_id = ${id}`);
  return row;
}

beforeAll(async () => {
  db = await openDatabase();
  await loadSource(db, fixture('sample.csv'));
  await cleanRecords(db);
});

describe('integrity (AC2)', () => {
  it('has one record per source row, with unique IDs', async () => {
    const [counts] = await queryRows(
      db,
      `SELECT CAST(count(*) AS INTEGER) AS records, CAST(count(DISTINCT record_id) AS INTEGER) AS ids FROM records`,
    );
    expect(counts).toEqual({ records: 34, ids: 34 });
  });
});

describe('dates (AC6)', () => {
  it('parses month/day/year into dates and years', async () => {
    expect(await record(2, 'notice_date, notice_year, paper_date, paper_year')).toEqual({
      notice_date: '2015-01-29',
      notice_year: 2015,
      paper_date: '2008-07-17',
      paper_year: 2008,
    });
  });

  it('handles dates before 1970', async () => {
    expect(await record(18930, 'notice_date, paper_date')).toEqual({
      notice_date: '1756-06-24',
      paper_date: '1753-01-01',
    });
  });

  it('keeps 1 January 1970 dates as recorded', async () => {
    expect(await record(43131, 'notice_date, paper_date')).toEqual({
      notice_date: '1970-01-01',
      paper_date: '1970-01-01',
    });
  });

  it('turns every parsed date back into its exact source text', async () => {
    const [{ mismatches }] = await queryRows(
      db,
      `SELECT CAST(count(*) AS INTEGER) AS mismatches FROM records
       WHERE strftime(notice_date, '%-m/%-d/%Y 0:00') IS DISTINCT FROM trim(original.notice_date)
          OR strftime(paper_date, '%-m/%-d/%Y 0:00') IS DISTINCT FROM trim(original.paper_date)`,
    );
    expect(mismatches).toBe(0);
  });
});

describe('DOIs (AC7)', () => {
  it('lowercases, so one DOI written two ways becomes the same value', async () => {
    expect(await record(12419, 'paper_doi')).toEqual({ paper_doi: '10.1212/wnl.57.3.445' });
    expect(await record(22992, 'paper_doi')).toEqual({ paper_doi: '10.1212/wnl.57.3.445' });
  });

  it('decodes percent-encoding and keeps old-style DOIs whole, semicolons included', async () => {
    expect(await record(698, 'notice_doi, paper_doi')).toEqual({
      notice_doi: '10.1002/(sici)1097-0215(19990517)81:4<669::aid-ijc27>3.0.co;2-c',
      paper_doi: '10.1002/(sici)1097-0215(19980330)76:1<154::aid-ijc24>3.0.co;2-b',
    });
  });

  it('keeps a trailing plus sign', async () => {
    expect(await record(148, 'paper_doi')).toEqual({ paper_doi: '10.1021/bi972113+' });
  });

  it.each([
    [17, '"unavailable"'],
    [241, '"Unavailable"'],
    [96, 'blank'],
  ])('treats the paper DOI of record %i (%s) as missing', async (id) => {
    expect(await record(id, 'paper_doi')).toEqual({ paper_doi: null });
  });

  it('keeps notice DOIs with a stray "x" prefix, for the profile report to list', async () => {
    expect(await record(70689, 'notice_doi')).toEqual({ notice_doi: 'x10.1007/978-3-030-00524-5_9' });
    expect(await record(70690, 'notice_doi')).toEqual({ notice_doi: 'xx10.1007/978-3-030-00524-5_9' });
  });
});

describe('PubMed IDs (AC8)', () => {
  it('keeps real IDs as numbers', async () => {
    expect(await record(2, 'notice_pubmed_id, paper_pubmed_id')).toEqual({
      notice_pubmed_id: 25767853,
      paper_pubmed_id: 18636547,
    });
  });

  it.each([
    [1086, '0'],
    [4952, 'blank'],
  ])('treats the PubMed IDs of record %i (%s) as missing', async (id) => {
    expect(await record(id, 'notice_pubmed_id, paper_pubmed_id')).toEqual({
      notice_pubmed_id: null,
      paper_pubmed_id: null,
    });
  });
});

describe('original values (AC4)', () => {
  it('keeps the exact source text of every value the cleaning rewrites', async () => {
    const [{ mismatches }] = await queryRows(
      db,
      `SELECT CAST(count(*) AS INTEGER) AS mismatches
       FROM records r JOIN source s ON r.record_id = CAST(s."Record ID" AS INTEGER)
       WHERE r.original.notice_date IS DISTINCT FROM s.RetractionDate
          OR r.original.notice_doi IS DISTINCT FROM s.RetractionDOI
          OR r.original.notice_pubmed_id IS DISTINCT FROM s.RetractionPubMedID
          OR r.original.paper_date IS DISTINCT FROM s.OriginalPaperDate
          OR r.original.paper_doi IS DISTINCT FROM s.OriginalPaperDOI
          OR r.original.paper_pubmed_id IS DISTINCT FROM s.OriginalPaperPubMedID`,
    );
    expect(mismatches).toBe(0);
  });

  it('shows what Retraction Watch wrote for a value the cleaning cleared', async () => {
    expect(await record(18930, 'paper_doi, original.paper_doi AS source_doi')).toEqual({
      paper_doi: null,
      source_doi: 'unavailable',
    });
  });
});
