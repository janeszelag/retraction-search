// Compares two snapshots of the CSV by Record ID (spec 003, AC4 to AC6) and
// writes diff.json and diff.md to data/diff/<previous snapshot>_to_<new snapshot>/.
// Usage: npm run diff -- --from <csv> --to <csv>
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadSource } from './clean.js';
import { openDatabase, queryRows, runSqlFile } from './duckdb.js';
import { fileExists } from './files.js';
import { diffDir, relativeToRepo } from './paths.js';
import { formatNumber, table } from './reports.js';

// Caps that keep diff.md readable and far below GitHub's job summary limit.
// diff.json always has everything.
export const MAX_REASON_LINES = 500;
export const MAX_RECORD_IDS = 200;

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

const describeSnapshot = ({ file, commit, data_date: dataDate }) =>
  dataDate && commit ? `${dataDate} (upstream commit ${commit.slice(0, 8)})` : file;

// The first `max` items, and a line saying how many more diff.json has.
function capped(items, max, render) {
  const shown = render(items.slice(0, max));
  return items.length > max ? `${shown}\n\n…and ${formatNumber(items.length - max)} more in diff.json.` : shown;
}

// diff.md: counts, changed columns, notice-type and reason changes, and the
// record IDs. It holds no titles or author names (AC6). `level` is the level
// of its top heading, so the update's summary can include it under its own.
export function diffMarkdown(diff, { level = 1 } = {}) {
  const heading = (offset, text) => `${'#'.repeat(level + offset)} ${text}`;
  const { counts } = diff;
  const ids = (change) => diff.records.filter((record) => record.change === change).map((record) => record.record_id);
  const idList = (list) => (list.length === 0 ? 'None.' : capped(list, MAX_RECORD_IDS, (shown) => shown.join(', ')));
  const changed = diff.records.filter((record) => record.change === 'changed');
  const valueRows = (column) =>
    diff.values.filter((value) => value.column === column).map((value) => [value.record_id, value.old, value.new]);
  const noticeTypes = valueRows('RetractionNature');
  const reasons = valueRows('Reason');

  return [
    heading(0, `Changes from ${describeSnapshot(diff.from)} to ${describeSnapshot(diff.to)}`),
    'Compared by Record ID, using the text Retraction Watch published rather than the cleaned values. The full lists are in diff.json.',
    table(
      ['', 'Records'],
      [
        ['Before', formatNumber(diff.from.records)],
        ['After', formatNumber(diff.to.records)],
        ['Added', formatNumber(counts.added)],
        ['Removed', formatNumber(counts.removed)],
        ['Changed', formatNumber(counts.changed)],
        ['With a filled field now empty', formatNumber(counts.emptied)],
      ],
    ),
    heading(1, 'Changed records per column'),
    diff.columns.length === 0
      ? 'No column changed.'
      : table(
          ['Column', 'Changed records', 'Of those, emptied'],
          diff.columns.map((row) => [row.column, formatNumber(row.changed), formatNumber(row.emptied)]),
        ),
    heading(1, `Notice type changes (${formatNumber(noticeTypes.length)})`),
    'A changed notice type moves a record between counts, for example from expressions of concern to retractions.',
    noticeTypes.length === 0 ? 'None.' : table(['Record ID', 'Before', 'After'], noticeTypes),
    heading(1, `Reason changes (${formatNumber(reasons.length)})`),
    'Reasons are Retraction Watch’s classification, and change as new information arrives.',
    reasons.length === 0
      ? 'None.'
      : capped(reasons, MAX_REASON_LINES, (shown) => table(['Record ID', 'Before', 'After'], shown)),
    heading(1, `Added records (${formatNumber(counts.added)})`),
    idList(ids('added')),
    heading(1, `Removed records (${formatNumber(counts.removed)})`),
    idList(ids('removed')),
    heading(1, `Changed records (${formatNumber(counts.changed)})`),
    changed.length === 0
      ? 'None.'
      : capped(changed, MAX_RECORD_IDS, (shown) =>
          table(
            ['Record ID', 'Changed columns', 'Emptied'],
            shown.map((record) => [record.record_id, record.columns.join(', '), record.emptied.join(', ') || '-']),
          ),
        ),
  ].join('\n\n') + '\n';
}

export function diffDirFor(fromPath, toPath, root = diffDir) {
  return path.join(root, `${snapshotName(fromPath)}_to_${snapshotName(toPath)}`);
}

// Compares the files and writes diff.json and diff.md. Returns the diff.
export async function runDiff({ fromPath, toPath, outputDir = diffDirFor(fromPath, toPath) }) {
  const diff = await compareSnapshots(fromPath, toPath);
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'diff.json'), `${JSON.stringify(diff, null, 2)}\n`);
  await writeFile(path.join(outputDir, 'diff.md'), diffMarkdown(diff));
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
