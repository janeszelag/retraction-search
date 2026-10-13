// Cleans one snapshot of the Retraction Watch CSV.
// Usage: npm run clean [-- --input <file>]  (default: the newest file in data/raw)
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { EXPECTED_COLUMNS } from './columns.js';
import { openDatabase, queryRows, runSqlFile, sqlIdentifier, sqlString } from './duckdb.js';
import { rawDir, relativeToRepo } from './paths.js';

export class ColumnCheckError extends Error {}

// Loads the CSV into the `source` table and checks its columns (AC3).
// Extra columns are allowed only when completely empty, like the one the
// header's trailing comma creates.
export async function loadSource(connection, inputPath) {
  await connection.run(`SET VARIABLE input_path = ${sqlString(inputPath)}`);
  await runSqlFile(connection, '00_load.sql');

  const columns = (await queryRows(connection, 'SELECT column_name FROM (DESCRIBE source)')).map(
    (row) => row.column_name,
  );
  const problems = EXPECTED_COLUMNS.filter((name) => !columns.includes(name)).map(
    (name) => `expected column "${name}" is missing`,
  );
  for (const name of columns.filter((column) => !EXPECTED_COLUMNS.includes(column))) {
    const [{ filled }] = await queryRows(
      connection,
      `SELECT count(*)::INTEGER AS filled FROM source WHERE nullif(trim(${sqlIdentifier(name)}), '') IS NOT NULL`,
    );
    if (filled > 0) {
      problems.push(`unexpected column "${name}" contains data`);
    }
  }
  if (problems.length > 0) {
    throw new ColumnCheckError(`Column check failed: ${problems.join('; ')}.`);
  }
}

export class IntegrityError extends Error {}

// Builds the `records` table from `source`, then checks that nothing was
// lost or duplicated on the way (AC2).
export async function cleanRecords(connection) {
  await runSqlFile(connection, '10_records.sql');

  const [counts] = await queryRows(
    connection,
    `SELECT
       (SELECT CAST(count(*) AS INTEGER) FROM source) AS source_rows,
       CAST(count(*) AS INTEGER) AS records,
       CAST(count(DISTINCT record_id) AS INTEGER) AS distinct_ids,
       CAST(count(*) FILTER (WHERE record_id IS NULL) AS INTEGER) AS missing_ids
     FROM records`,
  );
  const problems = [];
  if (counts.records !== counts.source_rows) {
    problems.push(`${counts.records} records from ${counts.source_rows} source rows`);
  }
  if (counts.missing_ids > 0) {
    problems.push(`${counts.missing_ids} records without a record ID`);
  }
  if (counts.distinct_ids !== counts.records - counts.missing_ids) {
    problems.push('duplicate record IDs');
  }
  if (problems.length > 0) {
    throw new IntegrityError(`Integrity check failed: ${problems.join('; ')}.`);
  }
}

// Snapshot files are named retraction_watch-<data date>-<short sha>.csv,
// so the newest sorts last.
export async function findNewestSnapshot() {
  const files = (await readdir(rawDir)).filter((file) => /^retraction_watch-.*\.csv$/.test(file)).sort();
  if (files.length === 0) {
    throw new Error(`No snapshots in ${relativeToRepo(rawDir)}. Run npm run download first.`);
  }
  return path.join(rawDir, files.at(-1));
}

async function main() {
  const { values } = parseArgs({ options: { input: { type: 'string' } } });
  // npm runs workspace scripts from pipeline/, but INIT_CWD is where the command was typed.
  const invokedFrom = process.env.INIT_CWD ?? process.cwd();
  const inputPath = values.input ? path.resolve(invokedFrom, values.input) : await findNewestSnapshot();
  const connection = await openDatabase();
  await loadSource(connection, inputPath);
  await cleanRecords(connection);
  const [{ rows }] = await queryRows(connection, 'SELECT count(*)::INTEGER AS rows FROM records');
  console.log(`Cleaned ${relativeToRepo(inputPath)}: ${rows} records, integrity checks passed.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
