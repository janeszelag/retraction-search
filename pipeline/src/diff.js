// Compares two snapshots of the CSV by Record ID (spec 003, AC4 to AC6) and
// writes diff.json to data/diff/<previous snapshot>_to_<new snapshot>/.
// Usage: npm run diff -- --from <csv> --to <csv>
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadSource } from './clean.js';
import { openDatabase, queryRows, runSqlFile } from './duckdb.js';
import { fileExists } from './files.js';
import { diffDir, relativeToRepo } from './paths.js';

// data/raw/retraction_watch-2026-10-09-bc5648dd.csv → 2026-10-09-bc5648dd
export function snapshotName(csvPath) {
  return path.basename(csvPath, '.csv').replace(/^retraction_watch-/, '');
}

// The file, plus its commit and data date from the download's manifest when there is one.
async function describeFile(csvPath, records) {
  const manifestPath = csvPath.replace(/\.csv$/, '.json');
  const manifest =
    manifestPath !== csvPath && (await fileExists(manifestPath)) ? JSON.parse(await readFile(manifestPath, 'utf8')) : null;
  return {
    file: path.basename(csvPath),
    commit: manifest?.commit ?? null,
    data_date: manifest?.data_date ?? null,
    records,
  };
}

// Loads both files the way the cleaning does (empty rows dropped, columns
// checked), then runs 40_diff.sql and reads its results.
export async function compareSnapshots(fromPath, toPath) {
  const connection = await openDatabase();
  await loadSource(connection, fromPath);
  await connection.run('ALTER TABLE source RENAME TO previous_source');
  await loadSource(connection, toPath);
  await runSqlFile(connection, '40_diff.sql');

  const [counts] = await queryRows(connection, 'SELECT * FROM diff_counts');
  return {
    from: await describeFile(fromPath, counts.previous_records),
    to: await describeFile(toPath, counts.new_records),
    counts: { added: counts.added, removed: counts.removed, changed: counts.changed, emptied: counts.emptied },
    columns: (
      await queryRows(
        connection,
        'SELECT source_column, changed_records, emptied_records FROM diff_columns ORDER BY position',
      )
    ).map((row) => ({ column: row.source_column, changed: row.changed_records, emptied: row.emptied_records })),
    values: (
      await queryRows(
        connection,
        'SELECT record_id, source_column, old_value, new_value FROM diff_values ORDER BY record_id, position',
      )
    ).map((row) => ({ record_id: row.record_id, column: row.source_column, old: row.old_value, new: row.new_value })),
    records: (
      await queryRows(
        connection,
        `SELECT record_id, change, changed_columns, emptied_columns FROM diff_records
         ORDER BY record_id`,
      )
    ).map((row) => ({
      record_id: row.record_id,
      change: row.change,
      columns: row.changed_columns,
      emptied: row.emptied_columns,
    })),
  };
}

export function diffDirFor(fromPath, toPath, root = diffDir) {
  return path.join(root, `${snapshotName(fromPath)}_to_${snapshotName(toPath)}`);
}

// Compares the files and writes diff.json. Returns the diff.
export async function runDiff({ fromPath, toPath, outputDir = diffDirFor(fromPath, toPath) }) {
  const diff = await compareSnapshots(fromPath, toPath);
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'diff.json'), `${JSON.stringify(diff, null, 2)}\n`);
  return { diff, outputDir };
}

async function main() {
  const { values } = parseArgs({ options: { from: { type: 'string' }, to: { type: 'string' } } });
  if (!values.from || !values.to) {
    throw new Error('Usage: npm run diff -- --from <csv> --to <csv>');
  }
  // npm runs workspace scripts from pipeline/, but INIT_CWD is where the command was typed.
  const invokedFrom = process.env.INIT_CWD ?? process.cwd();
  const started = performance.now();
  const { diff, outputDir } = await runDiff({
    fromPath: path.resolve(invokedFrom, values.from),
    toPath: path.resolve(invokedFrom, values.to),
  });
  const { added, removed, changed, emptied } = diff.counts;
  console.log(
    `Compared ${diff.from.file} (${diff.from.records} records) with ${diff.to.file} (${diff.to.records} records) in ${((performance.now() - started) / 1000).toFixed(1)} s: ${added} added, ${removed} removed, ${changed} changed, ${emptied} with a field emptied.`,
  );
  console.log(`Wrote ${relativeToRepo(outputDir)}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
