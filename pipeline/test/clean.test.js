import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSource, runCleaning } from '../src/clean.js';
import { openDatabase, queryRows, sqlString } from '../src/duckdb.js';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

describe('loading and the column check (AC3)', () => {
  it('loads the sample and ignores the empty column from the trailing comma', async () => {
    const db = await openDatabase();
    await loadSource(db, fixture('sample.csv'));

    const [{ rows }] = await queryRows(db, 'SELECT count(*)::INTEGER AS rows FROM source');
    expect(rows).toBe(37);
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
