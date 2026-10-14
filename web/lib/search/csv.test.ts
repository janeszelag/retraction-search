import { describe, expect, it } from 'vitest';
import { COLUMNS, csvCell, csvFileName, csvHeader, csvRow } from './csv';

const doc = {
  record_id: 7,
  notice_type: 'Retraction',
  title: 'A title, with a comma and "quotes"',
  journal: 'Synthetic Journal of Examples',
  publisher: 'Example Press',
  authors: ['Maria Example', "Jun O'Sample", 'Ana Placeholder'],
  institutions: ['Department of Examples, University of Somewhere'],
  countries: ['Côte d’Ivoire', 'Japan'],
  subjects: ['BLS: Neuroscience', 'HSC: Medicine - Oncology'],
  article_types: ['Research Article'],
  reasons: ['Duplication of/in Image', 'Manipulation of Images'],
  notice_date: Date.UTC(2026, 8, 24) / 1000,
  paper_date: Date.UTC(1753, 0, 1) / 1000,
  notice_doi: '10.1002/jcb.23190',
  notice_pubmed_id: 21598307,
  paywalled: 'No',
  is_revision: false,
  has_editorial_staff_author: true,
  urls: ['https://retractionwatch.com/2020/01/02/example/', 'https://example.org/a?b=c'],
  notes: 'A note\nover two lines',
};

// A minimal reader for the RFC 4180 subset csvLine writes.
function parse(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else if (char === '\r' && line[i + 1] === '\n') {
      break;
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

describe('CSV download (AC23)', () => {
  it('has one column per record-page field', () => {
    expect(parse(csvHeader())).toEqual(COLUMNS.map(([name]) => name));
  });

  it('writes the cleaned values, quoting where needed', () => {
    const row = Object.fromEntries(parse(csvRow(doc, 'https://example.org')).map((cell, index) => [COLUMNS[index][0], cell]));
    expect(row).toMatchObject({
      record_id: '7',
      title: 'A title, with a comma and "quotes"',
      notice_date: '2026-09-24',
      paper_date: '1753-01-01',
      paper_doi: '',
      notice_pubmed_id: '21598307',
      paper_pubmed_id: '',
      revised_version: 'no',
      editorial_staff_author: 'yes',
      notes: 'A note\nover two lines',
      record_page: 'https://example.org/record/7',
    });
  });

  it('lets every list field split back into its entries exactly', () => {
    const row = Object.fromEntries(parse(csvRow(doc, 'https://example.org')).map((cell, index) => [COLUMNS[index][0], cell]));
    const split = (cell: string) => cell.split(';').map((entry) => entry.trim());
    expect(split(row.author_names)).toEqual(doc.authors);
    expect(split(row.institutions)).toEqual(doc.institutions);
    expect(split(row.countries)).toEqual(doc.countries);
    expect(split(row.subjects)).toEqual(doc.subjects);
    expect(split(row.reasons)).toEqual(doc.reasons);
    expect(split(row.retraction_watch_links)).toEqual(doc.urls);
  });

  it('quotes cells only when they need it', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it('names the file with the data date', () => {
    expect(csvFileName('2026-10-09')).toBe('retraction-search-2026-10-09.csv');
  });
});
