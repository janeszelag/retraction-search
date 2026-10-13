// Cleans one snapshot of the Retraction Watch CSV.
// Usage: npm run clean [-- --input <file>]  (default: the newest file in data/raw)
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { EXPECTED_COLUMNS } from './columns.js';
import { openDatabase, queryRows, runSqlFile, sqlIdentifier, sqlString } from './duckdb.js';
import { cleanDir, rawDir, relativeToRepo } from './paths.js';

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

// Builds the `records` table from `source`, then checks its integrity.
export async function cleanRecords(connection) {
  await runSqlFile(connection, '10_records.sql');
  await checkIntegrity(connection);
}

// Fails the run if records were lost or duplicated (AC2), if a record has no
// notice type or more than one (AC12), or if splitting a list field lost or
// invented entries (AC10).
export async function checkIntegrity(connection) {
  const [counts] = await queryRows(
    connection,
    `SELECT
       (SELECT CAST(count(*) AS INTEGER) FROM source) AS source_rows,
       CAST(count(*) AS INTEGER) AS records,
       CAST(count(DISTINCT record_id) AS INTEGER) AS distinct_ids,
       CAST(count(*) FILTER (WHERE record_id IS NULL) AS INTEGER) AS missing_ids,
       CAST(count(*) FILTER (WHERE notice_type IS NULL OR contains(notice_type, ';')) AS INTEGER) AS bad_notice_types
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
  if (counts.bad_notice_types > 0) {
    problems.push(`${counts.bad_notice_types} records without exactly one notice type`);
  }
  const lists = await queryRows(connection, 'SELECT field, entries, source_items FROM list_integrity');
  for (const { field, entries, source_items: sourceItems } of lists) {
    if (entries !== sourceItems) {
      problems.push(`${field} has ${entries} list entries but ${sourceItems} items in the source text`);
    }
  }
  if (problems.length > 0) {
    throw new IntegrityError(`Integrity check failed: ${problems.join('; ')}.`);
  }
}

// Builds the `documents` table from `records` (AC13).
export async function buildDocuments(connection) {
  await runSqlFile(connection, '20_search_documents.sql');
}

// One JSON line per document, in record ID order, with missing values left out.
export async function documentLines(connection) {
  const rows = await queryRows(
    connection,
    'SELECT CAST(to_json(documents) AS VARCHAR) AS json FROM documents ORDER BY record_id',
  );
  return rows.map(({ json }) => JSON.stringify(withoutNulls(JSON.parse(json))));
}

function withoutNulls(value) {
  if (Array.isArray(value)) {
    return value.map(withoutNulls);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== null)
        .map(([key, entry]) => [key, withoutNulls(entry)]),
    );
  }
  return value;
}

// data/raw/retraction_watch-2026-10-09-bc5648dd.csv → data/clean/2026-10-09-bc5648dd
export function outputDirFor(inputPath) {
  const name = path.basename(inputPath, '.csv').replace(/^retraction_watch-/, '');
  return path.join(cleanDir, name);
}

export async function runCleaning({ inputPath, outputDir = outputDirFor(inputPath) }) {
  const connection = await openDatabase();
  await loadSource(connection, inputPath);
  await cleanRecords(connection);
  await buildDocuments(connection);

  await mkdir(outputDir, { recursive: true });
  await connection.run(
    `COPY (SELECT * FROM records ORDER BY record_id) TO ${sqlString(path.join(outputDir, 'records.parquet'))} (FORMAT parquet)`,
  );
  const lines = await documentLines(connection);
  await writeFile(path.join(outputDir, 'search-documents.jsonl'), `${lines.join('\n')}\n`);
  return { outputDir, records: lines.length };
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
  const started = performance.now();
  const result = await runCleaning({ inputPath });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(
    `Cleaned ${relativeToRepo(inputPath)}: ${result.records} records in ${seconds} s, written to ${relativeToRepo(result.outputDir)}.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
