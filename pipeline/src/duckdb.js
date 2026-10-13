import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { sqlDir } from './paths.js';

export async function openDatabase() {
  const instance = await DuckDBInstance.create(':memory:');
  return instance.connect();
}

// Quotes a value as a SQL string literal.
export function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

// Quotes a column or table name.
export function sqlIdentifier(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

export async function runSqlFile(connection, fileName) {
  const sql = await readFile(path.join(sqlDir, fileName), 'utf8');
  await connection.run(sql);
}

// Rows as plain values: dates become YYYY-MM-DD strings, lists become arrays,
// and BIGINTs become strings, so cast counts to INTEGER in SQL.
export async function queryRows(connection, sql) {
  const reader = await connection.runAndReadAll(sql);
  return reader.getRowObjectsJson();
}
