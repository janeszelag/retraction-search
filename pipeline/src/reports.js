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
