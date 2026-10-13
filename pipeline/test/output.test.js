import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCleaning } from '../src/clean.js';
import { openDatabase, queryRows, sqlString } from '../src/duckdb.js';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const OUTPUT_FILES = ['profile.md', 'records.parquet', 'search-documents.jsonl', 'size-report.md'];

let workDir;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'retraction-search-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('safe output (AC3)', () => {
  it('writes the four output files', async () => {
    const outputDir = path.join(workDir, 'out');
    await runCleaning({ inputPath: fixture('sample.csv'), outputDir });
    expect((await readdir(outputDir)).sort()).toEqual(OUTPUT_FILES);
  });

  it('leaves no output folder, and nothing partial, when a run fails', async () => {
    const outputDir = path.join(workDir, 'out');
    await expect(runCleaning({ inputPath: fixture('renamed-column.csv'), outputDir })).rejects.toThrow(
      'Column check failed',
    );
    expect(await readdir(workDir)).toEqual([]);
  });

  it('keeps the last good output when a later run fails', async () => {
    const outputDir = path.join(workDir, 'out');
    await runCleaning({ inputPath: fixture('sample.csv'), outputDir });
    const before = await readFile(path.join(outputDir, 'search-documents.jsonl'));

    await expect(runCleaning({ inputPath: fixture('missing-column.csv'), outputDir })).rejects.toThrow();

    expect(await readdir(workDir)).toEqual(['out']);
    expect((await readFile(path.join(outputDir, 'search-documents.jsonl'))).equals(before)).toBe(true);
  });

  it('replaces the previous output when a run succeeds', async () => {
    const outputDir = path.join(workDir, 'out');
    await runCleaning({ inputPath: fixture('subject-without-code.csv'), outputDir });
    await runCleaning({ inputPath: fixture('sample.csv'), outputDir });

    const lines = (await readFile(path.join(outputDir, 'search-documents.jsonl'), 'utf8')).trimEnd().split('\n');
    expect(lines).toHaveLength(37);
    expect(await readdir(workDir)).toEqual(['out']);
  });
});

describe('repeatable output (AC5)', () => {
  it('gives identical files, and the same Parquet content, when run twice on the same input', async () => {
    const first = path.join(workDir, 'first');
    const second = path.join(workDir, 'second');
    await runCleaning({ inputPath: fixture('sample.csv'), outputDir: first });
    await runCleaning({ inputPath: fixture('sample.csv'), outputDir: second });

    for (const file of ['search-documents.jsonl', 'profile.md', 'size-report.md']) {
      const [a, b] = await Promise.all([readFile(path.join(first, file)), readFile(path.join(second, file))]);
      expect(a.equals(b), file).toBe(true);
    }

    const db = await openDatabase();
    const a = sqlString(path.join(first, 'records.parquet'));
    const b = sqlString(path.join(second, 'records.parquet'));
    const [counts] = await queryRows(
      db,
      `SELECT
         (SELECT CAST(count(*) AS INTEGER) FROM read_parquet(${a})) AS rows,
         (SELECT CAST(count(*) AS INTEGER) FROM (SELECT * FROM read_parquet(${a}) EXCEPT SELECT * FROM read_parquet(${b}))) AS only_first,
         (SELECT CAST(count(*) AS INTEGER) FROM (SELECT * FROM read_parquet(${b}) EXCEPT SELECT * FROM read_parquet(${a}))) AS only_second`,
    );
    expect(counts).toEqual({ rows: 37, only_first: 0, only_second: 0 });
  });
});
