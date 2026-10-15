// The CSV download's format (spec 002 AC23): one column per field shown on
// record pages, with list fields joined by "; ". No list entry contains a
// semicolon, because the cleaning split on semicolons, so splitting a cell on
// ";" and trimming gives the entries back exactly.

// A byte-order mark, so spreadsheet apps read the file as UTF-8 and keep non-English characters.
export const BOM = '\uFEFF';

const LIST_SEPARATOR = '; ';

// The document fields the download reads, which is also what the export asks Typesense for.
export const EXPORT_FIELDS = [
  'record_id',
  'notice_type',
  'title',
  'journal',
  'publisher',
  'authors',
  'institutions',
  'countries',
  'subjects',
  'article_types',
  'reasons',
  'notice_date',
  'paper_date',
  'notice_doi',
  'paper_doi',
  'notice_pubmed_id',
  'paper_pubmed_id',
  'paywalled',
  'is_revision',
  'has_editorial_staff_author',
  'urls',
  'notes',
] as const;

type Document = Record<string, unknown>;

// Unix seconds (negative before 1970) to YYYY-MM-DD.
const isoDate = (value: unknown) => (typeof value === 'number' ? new Date(value * 1000).toISOString().slice(0, 10) : '');
const list = (value: unknown) => (Array.isArray(value) ? value.map(String).join(LIST_SEPARATOR) : '');
const text = (value: unknown) => (value === undefined || value === null ? '' : String(value));

// Columns in order: the header, and how each cell is made from a document.
export const COLUMNS: [string, (doc: Document, siteOrigin: string) => string][] = [
  ['record_id', (doc) => text(doc.record_id)],
  ['notice_type', (doc) => text(doc.notice_type)],
  ['title', (doc) => text(doc.title)],
  ['journal', (doc) => text(doc.journal)],
  ['publisher', (doc) => text(doc.publisher)],
  ['author_names', (doc) => list(doc.authors)],
  ['institutions', (doc) => list(doc.institutions)],
  ['countries', (doc) => list(doc.countries)],
  ['subjects', (doc) => list(doc.subjects)],
  ['article_types', (doc) => list(doc.article_types)],
  ['reasons', (doc) => list(doc.reasons)],
  ['notice_date', (doc) => isoDate(doc.notice_date)],
  ['paper_date', (doc) => isoDate(doc.paper_date)],
  ['notice_doi', (doc) => text(doc.notice_doi)],
  ['paper_doi', (doc) => text(doc.paper_doi)],
  ['notice_pubmed_id', (doc) => text(doc.notice_pubmed_id)],
  ['paper_pubmed_id', (doc) => text(doc.paper_pubmed_id)],
  ['notice_paywalled', (doc) => text(doc.paywalled)],
  ['revised_version', (doc) => (doc.is_revision === true ? 'yes' : 'no')],
  ['editorial_staff_author', (doc) => (doc.has_editorial_staff_author === true ? 'yes' : 'no')],
  ['retraction_watch_links', (doc) => list(doc.urls)],
  ['notes', (doc) => text(doc.notes)],
  ['record_page', (doc, siteOrigin) => `${siteOrigin}/record/${text(doc.record_id)}`],
];

// RFC 4180: quote a cell holding a comma, a quote or a line break, doubling its quotes.
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function csvLine(cells: string[]): string {
  return `${cells.map(csvCell).join(',')}\r\n`;
}

export const csvHeader = () => csvLine(COLUMNS.map(([name]) => name));

export const csvRow = (doc: Document, siteOrigin: string) => csvLine(COLUMNS.map(([, cell]) => cell(doc, siteOrigin)));

// retraction-search-2026-10-09.csv
export const csvFileName = (dataDate: string) => `retraction-search-${dataDate}.csv`;
