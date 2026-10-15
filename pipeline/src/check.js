// Checks the cleaning on a full snapshot (spec 001, task 11): cleans it twice and
// verifies the outputs. Usage: npm run check [-- --input <file>]
// (default: the newest file in data/raw)
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { findNewestSnapshot, runCleaning } from './clean.js';
import { openDatabase, queryRows, sqlString } from './duckdb.js';
import { relativeToRepo } from './paths.js';

const TIME_LIMIT_SECONDS = 60;

function countLines(buffer) {
  let lines = 0;
  for (const byte of buffer) {
    if (byte === 0x0a) {
      lines += 1;
    }
  }
  return lines;
}

// Rows of the profile's list integrity table: field, entries, source items, match.
function listIntegrityRows(profile) {
  const section = profile.slice(profile.indexOf('## List integrity'));
  return [...section.matchAll(/^\| (\w+) \| ([\d,]+) \| ([\d,]+) \| (yes|NO) \|$/gm)].map((match) => ({
    field: match[1],
    matches: match[4] === 'yes',
  }));
}

export async function checkSnapshot(inputPath) {
  const workDir = await mkdtemp(path.join(tmpdir(), 'retraction-search-check-'));
  try {
    const first = path.join(workDir, 'first');
    const second = path.join(workDir, 'second');

    const started = performance.now();
    await runCleaning({ inputPath, outputDir: first });
    const seconds = (performance.now() - started) / 1000;
    await runCleaning({ inputPath, outputDir: second });

    const parquetA = sqlString(path.join(first, 'records.parquet'));
    const parquetB = sqlString(path.join(second, 'records.parquet'));
    const csv = `read_csv(${sqlString(inputPath)}, header = true, all_varchar = true, delim = ',', quote = '"', escape = '"')`;
    const [counts] = await queryRows(
      await openDatabase(),
      `SELECT
         (SELECT CAST(count(*) AS INTEGER) FROM ${csv}) AS source_rows,
         -- Rows where every field is empty or only spaces, which the cleaning drops (AC2).
         -- In a WHERE clause, COLUMNS(*) applies the condition to every column and joins them with AND.
         (SELECT CAST(count(*) AS INTEGER) FROM ${csv} WHERE nullif(trim(COLUMNS(*)), '') IS NULL) AS empty_rows,
         (SELECT CAST(count(*) AS INTEGER) FROM read_parquet(${parquetA})) AS records,
         (SELECT CAST(count(DISTINCT record_id) AS INTEGER) FROM read_parquet(${parquetA})) AS distinct_ids,
         (SELECT CAST(count(*) FILTER (WHERE notice_type IS NULL OR contains(notice_type, ';')) AS INTEGER)
            FROM read_parquet(${parquetA})) AS bad_notice_types,
         (SELECT CAST(count(*) AS INTEGER) FROM (
            SELECT * FROM read_parquet(${parquetA}) EXCEPT SELECT * FROM read_parquet(${parquetB}))) AS only_first,
         (SELECT CAST(count(*) AS INTEGER) FROM (
            SELECT * FROM read_parquet(${parquetB}) EXCEPT SELECT * FROM read_parquet(${parquetA}))) AS only_second`,
    );

    const documents = countLines(await readFile(path.join(first, 'search-documents.jsonl')));
    const lists = listIntegrityRows(await readFile(path.join(first, 'profile.md'), 'utf8'));
    const identicalFiles = [];
    for (const file of ['search-documents.jsonl', 'profile.md', 'size-report.md']) {
      const [a, b] = await Promise.all([readFile(path.join(first, file)), readFile(path.join(second, file))]);
      identicalFiles.push(a.equals(b));
    }

    const rowsWithData = counts.source_rows - counts.empty_rows;
    return {
      rows: counts.source_rows,
      results: [
        {
          label: 'AC2',
          passed: counts.records === rowsWithData && documents === rowsWithData,
          detail: `one record and one document per source row with data (${counts.records} records, ${documents} documents, ${counts.empty_rows} empty rows dropped)`,
        },
        {
          label: 'AC2',
          passed: counts.distinct_ids === counts.records,
          detail: 'record IDs are unique',
        },
        {
          label: 'AC10',
          passed: lists.length === 7 && lists.every((row) => row.matches),
          detail: `list entries match source items in all ${lists.length} list fields`,
        },
        {
          label: 'AC12',
          passed: counts.bad_notice_types === 0,
          detail: 'every record has exactly one notice type',
        },
        {
          label: 'AC5',
          passed: identicalFiles.every(Boolean) && counts.only_first === 0 && counts.only_second === 0,
          detail: 'a second run gave identical output',
        },
        {
          label: 'time',
          passed: seconds < TIME_LIMIT_SECONDS,
          detail: `cleaning took ${seconds.toFixed(1)} s (limit ${TIME_LIMIT_SECONDS} s)`,
        },
      ],
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function main() {
  const { values } = parseArgs({ options: { input: { type: 'string' } } });
  const invokedFrom = process.env.INIT_CWD ?? process.cwd();
  const inputPath = values.input ? path.resolve(invokedFrom, values.input) : await findNewestSnapshot();
  const { rows, results } = await checkSnapshot(inputPath);

  console.log(`Checked ${relativeToRepo(inputPath)} (${rows.toLocaleString('en-US')} rows):`);
  for (const { label, passed, detail } of results) {
    console.log(`  ${passed ? 'pass' : 'FAIL'}  ${label.padEnd(5)} ${detail}`);
  }
  const failed = results.filter((result) => !result.passed).length;
  console.log(failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`);
  process.exitCode = failed === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
