import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProfile, cleanRecords, loadSource, runCleaning } from '../src/clean.js';
import { openDatabase, queryRows, sqlString } from '../src/duckdb.js';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

describe('loading and the column check (AC3)', () => {
  it('loads the sample and ignores the empty column from the trailing comma', async () => {
    const db = await openDatabase();
    await loadSource(db, fixture('sample.csv'));

    const [{ rows }] = await queryRows(db, 'SELECT count(*)::INTEGER AS rows FROM source');
    expect(rows).toBe(37);
  });

  it('reads a file that starts with a byte-order mark, naming its first column "Record ID" (spec 003 AC23)', async () => {
    const db = await openDatabase();
    await loadSource(db, fixture('second-export.csv'));

    const columns = await queryRows(db, 'SELECT column_name FROM (DESCRIBE source)');
    expect(columns[0].column_name).toBe('Record ID');
    expect(columns).toHaveLength(20);
  });

  it.each([
    ['missing-column.csv', 'expected column "Journal" is missing'],
    ['renamed-column.csv', 'expected column "Reason" is missing'],
    ['renamed-column.csv', 'unexpected column "Reasons" contains data'],
    ['extra-column.csv', 'unexpected column "Extra" contains data'],
  ])('%s fails with the column named: %s', async (file, message) => {
    const db = await openDatabase();
    await expect(loadSource(db, fixture(file))).rejects.toThrow(message);
  });
});

describe('empty rows (AC2, changed 2026-10-14)', () => {
  let workDir;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'retraction-search-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  // sample.csv followed by extra lines, each with the source's 21 fields (20 commas).
  async function sampleWith(lines) {
    const file = path.join(workDir, 'input.csv');
    await writeFile(file, `${await readFile(fixture('sample.csv'), 'utf8')}${lines.map((line) => `${line}\n`).join('')}`);
    return file;
  }

  it('cleans empty-rows.csv to the same records and documents as sample.csv', async () => {
    const withEmpty = path.join(workDir, 'with-empty');
    const without = path.join(workDir, 'without');
    await runCleaning({ inputPath: fixture('empty-rows.csv'), outputDir: withEmpty });
    await runCleaning({ inputPath: fixture('sample.csv'), outputDir: without });

    const [a, b] = await Promise.all(
      [withEmpty, without].map((dir) => readFile(path.join(dir, 'search-documents.jsonl'))),
    );
    expect(a.equals(b)).toBe(true);

    const parquetA = sqlString(path.join(withEmpty, 'records.parquet'));
    const parquetB = sqlString(path.join(without, 'records.parquet'));
    const [counts] = await queryRows(
      await openDatabase(),
      `SELECT
         (SELECT CAST(count(*) AS INTEGER) FROM read_parquet(${parquetA})) AS records,
         (SELECT CAST(count(*) AS INTEGER) FROM (SELECT * FROM read_parquet(${parquetA}) EXCEPT SELECT * FROM read_parquet(${parquetB}))) AS only_a,
         (SELECT CAST(count(*) AS INTEGER) FROM (SELECT * FROM read_parquet(${parquetB}) EXCEPT SELECT * FROM read_parquet(${parquetA}))) AS only_b`,
    );
    expect(counts).toEqual({ records: 37, only_a: 0, only_b: 0 });
  });

  it('gives the number of empty rows dropped in the profile', async () => {
    const withEmpty = path.join(workDir, 'with-empty');
    const without = path.join(workDir, 'without');
    await runCleaning({ inputPath: fixture('empty-rows.csv'), outputDir: withEmpty });
    await runCleaning({ inputPath: fixture('sample.csv'), outputDir: without });

    const profile = await readFile(path.join(withEmpty, 'profile.md'), 'utf8');
    expect(profile).toContain('| Rows | 37 |');
    expect(profile).toContain('| Empty rows dropped (AC2) | 3 |');
    expect(await readFile(path.join(without, 'profile.md'), 'utf8')).toContain('| Empty rows dropped (AC2) | 0 |');
  });

  it('drops a row of only spaces but keeps a row with only a record ID', async () => {
    const db = await openDatabase();
    await loadSource(db, await sampleWith([`  , ${','.repeat(19)}`, `900000201${','.repeat(20)}`]));

    const [counts] = await queryRows(
      db,
      `SELECT
         CAST(count(*) AS INTEGER) AS rows,
         CAST(count(*) FILTER (WHERE "Record ID" = '900000201') AS INTEGER) AS id_only,
         (SELECT CAST(count(*) AS INTEGER) FROM empty_rows) AS dropped
       FROM source`,
    );
    expect(counts).toEqual({ rows: 38, id_only: 1, dropped: 1 });
  });

  it('still stops on a row with a title but no record ID', async () => {
    const inputPath = await sampleWith([`,Synthetic row: a title without a record ID${','.repeat(19)}`]);
    await expect(runCleaning({ inputPath, outputDir: path.join(workDir, 'out') })).rejects.toThrow(
      '1 records without a record ID',
    );
  });
});

// second-export.csv is sample.csv as upstream's second export writes it: line
// breaks, repeated spaces, a tab, 00000000 for missing PubMed IDs and a second
// date form (see fixtures/README.md).
describe('upstream’s second export (AC4, AC6, AC8, AC9, AC10, changed 2026-10-25)', () => {
  let workDir;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'retraction-search-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  const withoutOriginal = (line) => {
    const { original, ...document } = JSON.parse(line);
    return document;
  };

  it('cleans to the same records and documents as sample.csv, apart from the published text in original', async () => {
    const second = path.join(workDir, 'second-export');
    const first = path.join(workDir, 'sample');
    await runCleaning({ inputPath: fixture('second-export.csv'), outputDir: second });
    await runCleaning({ inputPath: fixture('sample.csv'), outputDir: first });

    const [a, b] = await Promise.all(
      [second, first].map(async (dir) =>
        (await readFile(path.join(dir, 'search-documents.jsonl'), 'utf8')).trim().split('\n').map(withoutOriginal),
      ),
    );
    expect(a).toHaveLength(37);
    expect(a).toEqual(b);

    const parquetA = sqlString(path.join(second, 'records.parquet'));
    const parquetB = sqlString(path.join(first, 'records.parquet'));
    const [counts] = await queryRows(
      await openDatabase(),
      `SELECT
         (SELECT CAST(count(*) AS INTEGER) FROM (
            SELECT * EXCLUDE (original) FROM read_parquet(${parquetA})
            EXCEPT SELECT * EXCLUDE (original) FROM read_parquet(${parquetB}))) AS only_second,
         (SELECT CAST(count(*) AS INTEGER) FROM (
            SELECT * EXCLUDE (original) FROM read_parquet(${parquetB})
            EXCEPT SELECT * EXCLUDE (original) FROM read_parquet(${parquetA}))) AS only_first,
         -- The same records keep a rewritten name or placeholder's source text,
         -- apart from record 34181's institution, which the second export writes None.
         (SELECT list(record_id ORDER BY record_id) FROM read_parquet(${parquetA}) AS a JOIN read_parquet(${parquetB}) AS b USING (record_id)
            WHERE (a.original.author IS NULL) <> (b.original.author IS NULL)
               OR (a.original.institution IS NULL) <> (b.original.institution IS NULL)
               OR (a.original.country IS NULL) <> (b.original.country IS NULL)
               OR (a.original.journal IS NULL) <> (b.original.journal IS NULL)
               OR (a.original.publisher IS NULL) <> (b.original.publisher IS NULL)) AS original_differs`,
    );
    expect(counts).toEqual({ only_second: 0, only_first: 0, original_differs: [34181] });
  });

  it('parses both date forms, empties 00000000 PubMed IDs and keeps what was published in original', async () => {
    const db = await openDatabase();
    await loadSource(db, fixture('second-export.csv'));
    await cleanRecords(db);
    const rows = await queryRows(
      db,
      `SELECT record_id, notice_date, paper_date, notice_pubmed_id, paper_pubmed_id,
              original.notice_date AS source_notice_date, original.notice_pubmed_id AS source_notice_pubmed_id
       FROM records WHERE record_id IN (1086, 18930) ORDER BY record_id`,
    );
    expect(rows).toEqual([
      {
        record_id: 1086,
        notice_date: '2016-01-01',
        paper_date: '2005-01-01',
        notice_pubmed_id: null,
        paper_pubmed_id: null,
        source_notice_date: '1/1/2016 0:00',
        source_notice_pubmed_id: '00000000',
      },
      {
        record_id: 18930,
        notice_date: '1756-06-24',
        paper_date: '1753-01-01',
        notice_pubmed_id: null,
        paper_pubmed_id: null,
        source_notice_date: '6/24/1756 12:00:00 AM',
        source_notice_pubmed_id: '00000000',
      },
    ]);
  });

  it('turns line breaks, tabs and repeated spaces into one space, and never splits at a line break', async () => {
    const db = await openDatabase();
    await loadSource(db, fixture('second-export.csv'));
    await cleanRecords(db);
    const rows = await queryRows(
      db,
      `SELECT record_id, title, journal, authors[1] AS first_author, institutions, notes
       FROM records WHERE record_id IN (1, 2, 4952, 69326) ORDER BY record_id`,
    );
    expect(rows.map((row) => [row.record_id, row.title?.slice(0, 18), row.journal, row.first_author])).toEqual([
      [1, 'Genistein protects', 'Journal of Cellular Biochemistry', 'Wanghui Ding'],
      [2, 'Regulation of Wnt/', 'Journal of Cellular Biochemistry', 'Chang Han'],
      [4952, 'Epidermal Growth F', 'Thorax', 'James Spicer'],
      [69326, 'Morpho-chemical ch', 'Environmental Research', 'Abdul Rehman'],
    ]);
    expect(rows[2].institutions).toEqual([
      'Guy’s Hospital, London, UK Kantar Health, Munich, Germany Concord Hospital, Sydney, Australia',
    ]);
    expect(rows[3].notes).toContain('retracted pdf. See also: https://');
    const [{ withWhitespace }] = await queryRows(
      db,
      `SELECT CAST(count(*) AS INTEGER) AS "withWhitespace" FROM records, unnest(institutions) AS entry(institution)
       WHERE regexp_matches(institution, '\\s\\s|[\\t\\n\\r]|^\\s|\\s$')`,
    );
    expect(withWhitespace).toBe(0);
  });

  // The 21 fields of a sample.csv row, with a record ID, title and notice type.
  const syntheticRow = (id, title, fields) => {
    const row = Array(21).fill('');
    Object.assign(row, { 0: id, 1: title, 16: 'Retraction' }, fields);
    return row.join(',');
  };
  async function sampleWith(lines) {
    const file = path.join(workDir, 'input.csv');
    await writeFile(file, `${await readFile(fixture('sample.csv'), 'utf8')}${lines.map((line) => `${line}\n`).join('')}`);
    return file;
  }

  it('drops an institution item that is only a line break, and the integrity check passes (AC10)', async () => {
    const db = await openDatabase();
    await loadSource(
      db,
      await sampleWith([
        syntheticRow('900000401', 'Synthetic row: an institution item that is only a line break', {
          3: '"Example University;\n;Sample Institute"',
        }),
      ]),
    );
    await cleanRecords(db);
    const [row] = await queryRows(db, 'SELECT institutions FROM records WHERE record_id = 900000401');
    expect(row.institutions).toEqual(['Example University', 'Sample Institute']);
  });

  it('reads an Institution of exactly None as empty, and keeps None in original (AC9)', async () => {
    const db = await openDatabase();
    const inputPath = await sampleWith([
      syntheticRow('900000403', 'Synthetic row: None inside a longer institution list', {
        3: '"None;Example University"',
      }),
    ]);
    await loadSource(db, inputPath);
    await db.run("UPDATE source SET Institution = ' None ' WHERE \"Record ID\" = '34181'");
    await cleanRecords(db);
    const rows = await queryRows(
      db,
      `SELECT record_id, institutions, original.institution AS source_institution
       FROM records WHERE record_id IN (34181, 900000403) ORDER BY record_id`,
    );
    expect(rows).toEqual([
      { record_id: 34181, institutions: [], source_institution: ' None ' },
      { record_id: 900000403, institutions: ['None', 'Example University'], source_institution: null },
    ]);
    const flags = await buildProfile(db, inputPath);
    expect(flags).toContain('| Institution written "None", read as empty | 1 |');
    expect(flags).toContain('| Institution placeholder rewritten to "Unknown" | 6 |');
  });

  it('still empties and lists a date in a third form (AC6)', async () => {
    const db = await openDatabase();
    const inputPath = await sampleWith([
      syntheticRow('900000402', 'Synthetic row: a date in a third form', { 10: '"June 24, 1756"' }),
    ]);
    await loadSource(db, inputPath);
    await cleanRecords(db);
    const [row] = await queryRows(db, 'SELECT notice_date FROM records WHERE record_id = 900000402');
    expect(row.notice_date).toBeNull();
    const profile = await buildProfile(db, inputPath);
    expect(profile).toContain('| 900000402 | June 24, 1756 |');
  });

  it('drops a row of only line breaks and tabs, like a row of only spaces (AC2)', async () => {
    const db = await openDatabase();
    await loadSource(db, await sampleWith([`"\n",\t${','.repeat(19)}`]));
    const [{ dropped }] = await queryRows(db, 'SELECT CAST(count(*) AS INTEGER) AS dropped FROM empty_rows');
    expect(dropped).toBe(1);
  });
});
