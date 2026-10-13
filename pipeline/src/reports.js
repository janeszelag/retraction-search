// Turns query results into the Markdown reports written next to the cleaned data.

// Filter fields in the order the profile lists them (names match the search documents).
const VALUE_FIELDS = [
  'notice_type',
  'paywalled',
  'reasons',
  'subject_categories',
  'subjects',
  'countries',
  'article_types',
  'publisher',
  'notice_year',
  'paper_year',
];

// Every review list appears, even when it's empty, so "none" is visible.
const REVIEW_ISSUES = [
  'Notice date that could not be parsed',
  'Paper date that could not be parsed',
  'Notice dated before its paper',
  'Dated 1 January 1970',
  'DOI whose source text does not start with "10."',
  'Subject without a code',
];

const formatNumber = (value) => value.toLocaleString('en-US');

function cell(value) {
  if (value === null || value === undefined || value === '') {
    return '(empty)';
  }
  return String(value).replaceAll('|', '\\|');
}

function table(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
}

// Field groups for the size report. Fields not listed land in "Other", so nothing is hidden.
const SIZE_GROUPS = [
  ['Searchable text', ['title', 'authors', 'institutions', 'journal', 'publisher']],
  [
    'Filters',
    [
      'countries',
      'subject_categories',
      'subjects',
      'article_types',
      'reasons',
      'notice_type',
      'paywalled',
      'is_revision',
      'has_editorial_staff_author',
      'notice_date',
      'notice_year',
      'paper_date',
      'paper_year',
    ],
  ],
  ['Identifiers', ['id', 'record_id', 'notice_doi', 'notice_pubmed_id', 'paper_doi', 'paper_pubmed_id']],
  ['Stored only', ['urls', 'notes', 'original']],
];

// Measures the JSON lines exactly as written (AC14).
export function measureDocuments(lines) {
  const fieldBytes = new Map();
  const documentBytes = [];
  let fileBytes = 0;
  for (const line of lines) {
    const bytes = Buffer.byteLength(line);
    fileBytes += bytes + 1; // each line ends with a newline
    const doc = JSON.parse(line);
    documentBytes.push({ recordId: doc.record_id, bytes });
    for (const [field, value] of Object.entries(doc)) {
      fieldBytes.set(field, (fieldBytes.get(field) ?? 0) + Buffer.byteLength(JSON.stringify(value)));
    }
  }
  const largest = documentBytes.sort((a, b) => b.bytes - a.bytes || a.recordId - b.recordId).slice(0, 5);
  return { documents: lines.length, fileBytes, fieldBytes, largest };
}

const megabytes = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;
const share = (part, whole) => `${((part / whole) * 100).toFixed(1)}%`;

export function sizeReportMarkdown({ file, documents, fileBytes, fieldBytes, largest }) {
  const grouped = SIZE_GROUPS.map(([group, fields]) => [group, fields.filter((field) => fieldBytes.has(field))]);
  const listed = new Set(SIZE_GROUPS.flatMap(([, fields]) => fields));
  const other = [...fieldBytes.keys()].filter((field) => !listed.has(field)).sort();
  if (other.length > 0) {
    grouped.push(['Other', other]);
  }

  const fieldRows = [];
  for (const [group, fields] of grouped) {
    const groupBytes = fields.reduce((sum, field) => sum + fieldBytes.get(field), 0);
    fieldRows.push([`**${group}**`, '(all)', formatNumber(groupBytes), share(groupBytes, fileBytes)]);
    for (const field of fields) {
      fieldRows.push([group, field, formatNumber(fieldBytes.get(field)), share(fieldBytes.get(field), fileBytes)]);
    }
  }
  const valueBytes = [...fieldBytes.values()].reduce((sum, bytes) => sum + bytes, 0);
  fieldRows.push([
    '**Field names and punctuation**',
    '(all)',
    formatNumber(fileBytes - valueBytes),
    share(fileBytes - valueBytes, fileBytes),
  ]);

  return `${[
    `# Size report: ${file}`,
    'Written by `npm run clean`, for decision record 002 (AC14). Sizes are measured on `search-documents.jsonl` exactly as written.',
    table(
      ['Item', 'Value'],
      [
        ['Documents', formatNumber(documents)],
        ['search-documents.jsonl', `${megabytes(fileBytes)} (${formatNumber(fileBytes)} bytes)`],
        ['Average document', `${formatNumber(Math.round(fileBytes / Math.max(documents, 1)))} bytes`],
      ],
    ),
    '## Bytes per field',
    "Each field's total counts the JSON text of its values. Field names and punctuation are counted separately.",
    table(['Group', 'Field', 'Bytes', 'Share of file'], fieldRows),
    '## Largest documents',
    table(
      ['Record ID', 'Bytes'],
      largest.map((doc) => [doc.recordId, formatNumber(doc.bytes)]),
    ),
  ].join('\n\n')}\n`;
}

export function profileMarkdown({ snapshot, emptyValues, values, review, listIntegrity, flags }) {
  const checksum =
    snapshot.manifestSha256 === null
      ? `${snapshot.sha256} (no manifest to compare with)`
      : snapshot.manifestSha256 === snapshot.sha256
        ? `${snapshot.sha256} (matches the manifest)`
        : `${snapshot.sha256} (does NOT match the manifest's ${snapshot.manifestSha256})`;
  const sections = [
    `# Profile: ${snapshot.file}`,
    'Written by `npm run clean`. Sections refer to the acceptance criteria in spec 001.',
    '## Snapshot',
    table(
      ['Item', 'Value'],
      [
        ['File', snapshot.file],
        ['Upstream commit', snapshot.commit ?? 'unknown (no manifest)'],
        ['Data date', snapshot.dataDate ?? 'unknown (no manifest)'],
        ['Rows', formatNumber(snapshot.rows)],
        ['Size', `${formatNumber(snapshot.bytes)} bytes`],
        ['SHA-256', checksum],
      ],
    ),
    '## Empty values (AC1)',
    table(
      ['Source column', 'Empty'],
      emptyValues.map((row) => [row.source_column, formatNumber(row.empty)]),
    ),
    '## Values of each filter field (AC1)',
    'Counts are records that have the value.',
  ];

  for (const field of VALUE_FIELDS) {
    const rows = values.filter((row) => row.field === field);
    sections.push(
      `### ${field} (${formatNumber(rows.length)} values)`,
      table(
        ['Value', 'Records'],
        rows.map((row) => [row.value, formatNumber(row.records)]),
      ),
    );
  }

  sections.push('## Review lists (AC6, AC7, AC11)');
  for (const issue of REVIEW_ISSUES) {
    const rows = review.filter((row) => row.issue === issue);
    sections.push(`### ${issue} (${formatNumber(rows.length)})`);
    sections.push(
      rows.length === 0
        ? 'None.'
        : table(
            ['Record ID', 'Value'],
            rows.map((row) => [row.record_id, row.value]),
          ),
    );
  }

  sections.push(
    '## List integrity (AC10)',
    'Entries after splitting, next to the non-empty semicolon-separated items in the source text. The run fails if any pair differs.',
    table(
      ['Field', 'List entries', 'Source items', 'Match'],
      listIntegrity.map((row) => [
        row.field,
        formatNumber(row.entries),
        formatNumber(row.source_items),
        row.entries === row.source_items ? 'yes' : 'NO',
      ]),
    ),
    '## Flags and rewrites (AC12)',
    table(
      ['Flag', 'Records'],
      flags.map((row) => [row.flag, formatNumber(row.records)]),
    ),
  );

  return `${sections.join('\n\n')}\n`;
}
