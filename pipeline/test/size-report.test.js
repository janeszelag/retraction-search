import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCleaning } from '../src/clean.js';
import { measureDocuments, sizeReportMarkdown } from '../src/reports.js';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

let workDir;
let report;
let lines;

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'retraction-search-'));
  const { outputDir } = await runCleaning({ inputPath: fixture('sample.csv'), outputDir: path.join(workDir, 'out') });
  report = await readFile(path.join(outputDir, 'size-report.md'), 'utf8');
  lines = (await readFile(path.join(outputDir, 'search-documents.jsonl'), 'utf8')).trimEnd().split('\n');
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('size report (AC14)', () => {
  it('gives the document count and the exact size of the file as written', async () => {
    const { size } = await stat(path.join(workDir, 'out', 'search-documents.jsonl'));
    expect(report).toContain('| Documents | 37 |');
    expect(report).toContain(`(${size.toLocaleString('en-US')} bytes)`);
  });

  it('has a line for every field in the documents', () => {
    const fields = new Set(lines.flatMap((line) => Object.keys(JSON.parse(line))));
    expect(fields.size).toBeGreaterThan(20);
    for (const field of fields) {
      expect(report, field).toMatch(new RegExp(`^\\| [A-Za-z ]+ \\| ${field} \\| [\\d,]+ \\| [\\d.]+% \\|$`, 'm'));
    }
  });

  it('lists the five largest documents, starting with the one with 88 authors', () => {
    const largest = report.slice(report.indexOf('## Largest documents'));
    const rows = largest.split('\n').filter((line) => /^\| \d+ \|/.test(line));
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatch(/^\| 41581 \|/);
  });

  it('puts fields it does not know about under "Other", so nothing is hidden', () => {
    const measured = measureDocuments(['{"id":"1","surprise":"x"}']);
    const markdown = sizeReportMarkdown({ file: 'test.csv', ...measured });
    expect(markdown).toContain('| Other | surprise | 3 |');
  });
});
