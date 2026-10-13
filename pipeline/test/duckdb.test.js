import { describe, expect, it } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';

describe('DuckDB', () => {
  it('runs a query in an in-memory database', async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();

    const reader = await connection.runAndReadAll('SELECT 1 AS one');

    expect(reader.getRowObjects()).toEqual([{ one: 1 }]);
    connection.closeSync();
  });
});
