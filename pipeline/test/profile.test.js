import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildProfile, cleanRecords, loadSource } from '../src/clean.js';
import { openDatabase } from '../src/duckdb.js';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

async function profileOf(file) {
  const db = await openDatabase();
  await loadSource(db, fixture(file));
  await cleanRecords(db);
  return buildProfile(db, fixture(file));
}

// The text under a heading, up to the next heading of the same or a higher level.
function section(markdown, heading) {
  const level = heading.match(/^#+/)[0].length;
  const start = markdown.indexOf(`${heading}\n`);
  expect(start, `heading "${heading}"`).toBeGreaterThanOrEqual(0);
  const rest = markdown.slice(start + heading.length + 1);
  const next = rest.search(new RegExp(`^#{1,${level}} `, 'm'));
  return next === -1 ? rest : rest.slice(0, next);
}

const tableRows = (text) => text.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Item'));

let profile;

beforeAll(async () => {
  profile = await profileOf('sample.csv');
});

describe('profile report', () => {
  it('describes the snapshot', () => {
    const snapshot = section(profile, '## Snapshot');
    expect(snapshot).toContain('| File | sample.csv |');
    expect(snapshot).toContain('| Rows | 37 |');
    expect(snapshot).toMatch(/\| SHA-256 \| [0-9a-f]{64} \(no manifest to compare with\) \|/);
  });

  it('counts empty values in the 20 source columns, without the trailing-comma column (AC1)', () => {
    const rows = tableRows(section(profile, '## Empty values (AC1)')).filter((row) => !row.startsWith('| Source column'));
    expect(rows).toHaveLength(20);
    expect(rows).toContain('| Notes | 20 |');
    expect(profile).not.toContain('column20');
  });

  it('lists every value of every filter field with its count (AC1)', () => {
    for (const [field, count] of [
      ['notice_type', 4],
      ['paywalled', 3],
    ]) {
      expect(profile).toContain(`### ${field} (${count} values)`);
    }
    for (const field of ['reasons', 'subject_categories', 'subjects', 'countries', 'article_types', 'publisher', 'notice_year', 'paper_year']) {
      expect(profile).toMatch(new RegExp(`^### ${field} \\(\\d+ values\\)$`, 'm'));
    }
    expect(section(profile, '### paywalled (3 values)')).toContain('| Unknown | 1 |');
  });

  it('lists dates and DOIs to review (AC6, AC7)', () => {
    expect(section(profile, '### Notice dated before its paper (1)')).toContain(
      '| 73705 | notice 2023-07-01, paper 2025-12-13 |',
    );
    expect(section(profile, '### Dated 1 January 1970 (1)')).toContain('| 43131 | notice and paper |');
    const dois = section(profile, '### DOI whose source text does not start with "10." (2)');
    expect(dois).toContain('| 70689 | notice DOI x10.1007/978-3-030-00524-5_9 |');
    expect(dois).toContain('| 70690 | notice DOI xx10.1007/978-3-030-00524-5_9 |');
    expect(section(profile, '### Notice date that could not be parsed (0)').trim()).toBe('None.');
  });

  it('lists subjects without a code (AC11)', async () => {
    const synthetic = await profileOf('subject-without-code.csv');
    expect(section(synthetic, '### Subject without a code (1)')).toContain('| 900000001 | No code here |');
  });

  it('lists and counts the name fixes (spec 002)', async () => {
    const synthetic = await profileOf('names.csv');
    expect(section(synthetic, '### Backtick in an author name (1)')).toContain('| 900000101 | Maria O`Example;Jun Sample`;`Ana Placeholder |');
    const merged = section(synthetic, '### Journal or publisher spelling merged (4)');
    expect(merged).toContain('| 900000102 | journal "Synthetic journal of examples" became "Synthetic Journal of Examples" |');
    expect(merged).toContain('| 900000105 | publisher "tie press" became "Tie Press" |');
    const flags = section(synthetic, '## Flags and rewrites (AC12)');
    expect(flags).toContain('| Backtick fixed in an author name | 1 |');
    expect(flags).toContain('| Journal spelling merged into the most common one | 2 |');
    expect(flags).toContain('| Publisher spelling merged into the most common one | 2 |');
    expect(flags).toContain('| Author placeholder rewritten to "Unknown" | 0 |');
  });

  it('shows list integrity for all seven list fields (AC10)', () => {
    const rows = tableRows(section(profile, '## List integrity (AC10)')).filter((row) => !row.startsWith('| Field'));
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(row).toMatch(/\| yes \|$/);
    }
  });

  it('counts the values whose whitespace changed, per column (AC9, changed 2026-10-25)', async () => {
    const rowsOf = (markdown) =>
      tableRows(section(markdown, '## Whitespace (AC9)')).filter((row) => !row.startsWith('| Source column'));
    expect(rowsOf(profile)).toHaveLength(11);
    expect(rowsOf(profile).every((row) => row.endsWith('| 0 |'))).toBe(true);

    const secondExportProfile = await profileOf('second-export.csv');
    expect(section(secondExportProfile, '## Flags and rewrites (AC12)')).toContain('| Institution written "None", read as empty | 1 |');
    const secondExport = rowsOf(secondExportProfile);
    expect(secondExport.filter((row) => !row.endsWith('| 0 |'))).toEqual([
      '| Title | 1 |',
      '| Institution | 12 |',
      '| Journal | 1 |',
      '| Author | 1 |',
      '| Notes | 1 |',
    ]);
  });

  it('counts flags and rewrites (AC12)', () => {
    const flags = section(profile, '## Flags and rewrites (AC12)');
    expect(flags).toContain('| Revised version (is_revision) | 1 |');
    expect(flags).toContain('| Editorial Staff author (has_editorial_staff_author) | 2 |');
    expect(flags).toContain('| Author placeholder rewritten to "Unknown" | 1 |');
    expect(flags).toContain('| Stray "x" removed from a DOI | 2 |');
  });
});
