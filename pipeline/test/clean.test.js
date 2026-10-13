import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSource } from '../src/clean.js';
import { openDatabase, queryRows } from '../src/duckdb.js';

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
