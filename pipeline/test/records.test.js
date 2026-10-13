import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { checkIntegrity, cleanRecords, loadSource } from '../src/clean.js';
import { openDatabase, queryRows } from '../src/duckdb.js';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

async function cleanedDatabase(file = 'sample.csv') {
  const connection = await openDatabase();
  await loadSource(connection, fixture(file));
  await cleanRecords(connection);
  return connection;
}

let db;

async function record(id, columns) {
  const [row] = await queryRows(db, `SELECT ${columns} FROM records WHERE record_id = ${id}`);
  return row;
}

beforeAll(async () => {
  db = await cleanedDatabase();
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

describe('list fields (AC9)', () => {
  it('splits on semicolons and drops the empty entry after a trailing semicolon', async () => {
    expect(await record(2, 'authors, countries, article_types, reasons')).toEqual({
      authors: ['Chang Han', 'Kyu Lim', 'Lihong Xu', 'Guiying Li', 'Tong Wu'],
      countries: ['United States'],
      article_types: ['Research Article'],
      reasons: [
        'Duplication of/in Image',
        'Falsification/Fabrication of Image',
        'Investigation by Company/Institution',
      ],
    });
  });

  it('trims entries separated by "; "', async () => {
    expect(
      await record(
        10,
        'countries, CAST(len(institutions) AS INTEGER) AS institution_count, institutions[2] AS second_institution',
      ),
    ).toEqual({
      countries: ['Italy', 'United States'],
      institution_count: 3,
      second_institution: 'National Institute for Infectious Diseases ‘‘Lazzaro Spallanzani’’, Rome, Italy',
    });
  });

  it('keeps author order', async () => {
    expect(
      await record(
        41581,
        'CAST(len(authors) AS INTEGER) AS author_count, authors[1] AS first_author, authors[-1] AS last_author',
      ),
    ).toEqual({ author_count: 88, first_author: 'Carlo Fischer', last_author: 'Jan Felix Drexler' });
  });

  it('keeps "Unknown" as a country', async () => {
    expect(await record(1134, 'countries')).toEqual({ countries: ['Unknown'] });
  });

  it('gives an empty field an empty list', async () => {
    expect(await record(34181, 'institutions')).toEqual({ institutions: [] });
  });

  it('splits several URLs', async () => {
    expect(await record(4, 'CAST(len(urls) AS INTEGER) AS url_count')).toEqual({ url_count: 2 });
  });

  it('never splits titles, journals or notes', async () => {
    expect(await record(1511, 'title')).toEqual({
      title: 'Complex t(2;21;8)(p12;q22;q22): a Variant t(8;21) in a Patient with Acute Myeloid Leukemia (AML-M2)',
    });
    expect(await record(69326, 'notes')).toEqual({
      notes:
        'HTML overwrite; date of retraction estimated from date modified on retracted pdf. See also: https://pubpeer.com/publications/8D63E2AE657E5CB8B96E044C60585B',
    });
    const [{ same }] = await queryRows(
      db,
      `SELECT r.journal = trim(s.Journal) AND contains(r.journal, ';') AS same
       FROM records r JOIN source s ON r.record_id = CAST(s."Record ID" AS INTEGER) WHERE r.record_id = 28020`,
    );
    expect(same).toBe(true);
  });
});

describe('list integrity (AC10)', () => {
  it('has as many list entries as source items in every list field', async () => {
    const rows = await queryRows(db, 'SELECT field, entries, source_items FROM list_integrity ORDER BY field');
    expect(rows.map((row) => row.field)).toEqual([
      'article_types',
      'authors',
      'countries',
      'institutions',
      'reasons',
      'subjects',
      'urls',
    ]);
    for (const row of rows) {
      expect(row.entries).toBe(row.source_items);
    }
  });

  it('fails the run when a split loses an entry', async () => {
    const broken = await cleanedDatabase();
    await broken.run('UPDATE records SET authors = authors[2:] WHERE record_id = 41581');
    await expect(checkIntegrity(broken)).rejects.toThrow(/authors has \d+ list entries but \d+ items/);
  });
});

describe('subjects (AC11)', () => {
  it('splits each subject into its code and name', async () => {
    expect(await record(35, 'subjects')).toEqual({
      subjects: [
        { code: 'BLS', name: 'Biology - Cellular' },
        { code: 'BLS', name: 'Nutrition' },
        { code: 'HSC', name: 'Medicine - Cardiovascular' },
        { code: 'HSC', name: 'Medicine - Diabetes' },
      ],
    });
  });

  it('gives a subject without a code an empty code', async () => {
    const synthetic = await cleanedDatabase('subject-without-code.csv');
    const [row] = await queryRows(synthetic, 'SELECT subjects FROM records WHERE record_id = 900000001');
    expect(row.subjects).toEqual([
      { code: null, name: 'No code here' },
      { code: 'HSC', name: 'Medicine - Surgery' },
    ]);
  });
});

describe('notice type and flags (AC12)', () => {
  it.each([
    [2, 'Retraction'],
    [12, 'Correction'],
    [18, 'Expression of concern'],
    [333, 'Reinstatement'],
  ])('record %i is a %s', async (id, noticeType) => {
    expect(await record(id, 'notice_type')).toEqual({ notice_type: noticeType });
  });

  it('fails the run when a record has no notice type', async () => {
    const broken = await cleanedDatabase();
    await broken.run('UPDATE records SET notice_type = NULL WHERE record_id = 2');
    await expect(checkIntegrity(broken)).rejects.toThrow('1 records without exactly one notice type');
  });

  it('flags revised versions', async () => {
    expect(await record(3804, 'is_revision')).toEqual({ is_revision: true });
    expect(await record(2, 'is_revision')).toEqual({ is_revision: false });
  });

  it('flags "Editorial Staff" authors in any spelling', async () => {
    expect(await record(69493, 'has_editorial_staff_author')).toEqual({ has_editorial_staff_author: true });
    expect(await record(69833, 'has_editorial_staff_author')).toEqual({ has_editorial_staff_author: true });
    expect(await record(2, 'has_editorial_staff_author')).toEqual({ has_editorial_staff_author: false });
  });

  it.each([
    [2, 'No'],
    [6, 'Yes'],
    [859, 'Unknown'],
  ])('record %i has paywalled %s', async (id, paywalled) => {
    expect(await record(id, 'paywalled')).toEqual({ paywalled });
  });
});
