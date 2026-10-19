// The expected answers for npm run check:search, from DuckDB on the same search
// documents that `npm run load` put in Typesense. The filters are written
// again here in SQL, from the spec rather than from the Typesense mapping, so
// a mistake in one shows up as a difference.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance } from '@duckdb/node-api';
import { parseSubjectValue } from '../lib/query/subjects';
import { LIST_FILTER_KEYS, type FilterKey, type Query } from '../lib/query/types';
import type { Meta } from '../lib/search/types';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export const sql = (value: string) => `'${value.replaceAll("'", "''")}'`;
const sqlList = (values: string[]) => `[${values.map(sql).join(', ')}]`;

export interface Snapshot {
  rows<T = Record<string, unknown>>(query: string): Promise<T[]>;
  close(): void;
}

// The snapshot's search documents, as a table named docs.
export async function openSnapshot(meta: Meta): Promise<Snapshot> {
  const folder = `${meta.dataDate}-${meta.commit}`;
  const file = path.join(repoRoot, 'data', 'clean', folder, 'search-documents.jsonl');
  if (!existsSync(file)) {
    // As when checking the hosted server, whose snapshot the daily update cleaned elsewhere.
    throw new Error(
      `The server holds the snapshot ${folder}, which isn't cleaned on this computer. Run npm run download -- --commit ${meta.commit}, then npm run clean -- --input data/raw/retraction_watch-${folder}.csv.`,
    );
  }
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  await connection.run(`CREATE TABLE docs AS SELECT * FROM read_json(${sql(file)}, format = 'newline_delimited', sample_size = -1)`);
  // Author names match ignoring capitals, accents and punctuation (spec 002 AC14).
  await connection.run(String.raw`CREATE MACRO name_key(x) AS lower(strip_accents(regexp_replace(x, '[^\p{L}\p{N}\s]', '', 'g')))`);
  // The words Typesense searches, split the way it splits them: at spaces, and
  // at hyphens and slashes in every searched field but author names. Other
  // punctuation is dropped from inside a word ("He'nan" is "henan", "Wuhan
  // 430072,Hubei" ends in "430072hubei"), and capitals and accents are ignored.
  await connection.run(String.raw`CREATE MACRO field_words(x, separators) AS list_filter(
    list_transform(regexp_split_to_array(lower(strip_accents(coalesce(x, ''))), separators), lambda t: regexp_replace(t, '[^\p{L}\p{N}]', '', 'g')),
    lambda t: t <> '')`);
  await connection.run(String.raw`CREATE TABLE search_words AS SELECT record_id, flatten([
    field_words(title, '[\s/-]+'), field_words(journal, '[\s/-]+'), field_words(publisher, '[\s/-]+'),
    flatten(list_transform(coalesce(institutions, []), lambda i: field_words(i, '[\s/-]+'))),
    flatten(list_transform(coalesce(authors, []), lambda a: field_words(a, '\s+')))
  ]) AS words FROM docs`);
  return {
    async rows<T>(query: string) {
      return (await connection.runAndReadAll(query)).getRowObjectsJson() as T[];
    },
    close() {
      connection.closeSync();
      instance.closeSync();
    },
  };
}

// The parts of a query that have counts of their own, and the fields they count.
export type Part = FilterKey | 'notice_years' | 'paper_years' | 'revisions' | 'editorial_staff';

export const PART_FIELDS: Record<Part, string[]> = {
  type: ['notice_type'],
  reason: ['reasons'],
  subject: ['subjects', 'subject_categories'],
  country: ['countries'],
  article_type: ['article_types'],
  journal: ['journal'],
  publisher: ['publisher'],
  paywalled: ['paywalled'],
  notice_years: ['notice_year'],
  paper_years: ['paper_year'],
  revisions: ['is_revision'],
  editorial_staff: ['has_editorial_staff_author'],
};

export const LIST_FIELDS = new Set(['reasons', 'subjects', 'subject_categories', 'countries', 'article_types']);

const COLUMNS: Record<Exclude<FilterKey, 'subject'>, string> = {
  type: 'notice_type',
  reason: 'reasons',
  country: 'countries',
  article_type: 'article_types',
  journal: 'journal',
  publisher: 'publisher',
  paywalled: 'paywalled',
};

function filterCondition(query: Query, key: FilterKey): string | null {
  const { include, exclude, match } = query.filters[key];
  const conditions: string[] = [];
  if (key === 'subject') {
    const categories = (values: string[]) => values.filter((value) => parseSubjectValue(value).kind === 'category');
    const subjects = (values: string[]) => values.filter((value) => parseSubjectValue(value).kind === 'subject');
    if (include.length > 0) {
      const parts = [
        ...(categories(include).length > 0 ? [`list_has_${match}(subject_categories, ${sqlList(categories(include))})`] : []),
        ...(subjects(include).length > 0 ? [`list_has_${match}(subjects, ${sqlList(subjects(include))})`] : []),
      ];
      conditions.push(`(${parts.join(match === 'all' ? ' AND ' : ' OR ')})`);
    }
    if (categories(exclude).length > 0) {
      conditions.push(`NOT list_has_any(subject_categories, ${sqlList(categories(exclude))})`);
    }
    if (subjects(exclude).length > 0) {
      conditions.push(`NOT list_has_any(subjects, ${sqlList(subjects(exclude))})`);
    }
  } else {
    const column = COLUMNS[key];
    const isList = LIST_FILTER_KEYS.includes(key);
    if (include.length > 0) {
      conditions.push(isList ? `list_has_${match}(${column}, ${sqlList(include)})` : `${column} IN (${include.map(sql).join(', ')})`);
    }
    if (exclude.length > 0) {
      conditions.push(isList ? `NOT list_has_any(${column}, ${sqlList(exclude)})` : `${column} NOT IN (${exclude.map(sql).join(', ')})`);
    }
  }
  return conditions.length > 0 ? conditions.join(' AND ') : null;
}

function yearCondition(column: string, range: { from: number | null; to: number | null }): string | null {
  const conditions = [...(range.from !== null ? [`${column} >= ${range.from}`] : []), ...(range.to !== null ? [`${column} <= ${range.to}`] : [])];
  return conditions.length > 0 ? conditions.join(' AND ') : null;
}

// One SQL condition per part of a filter-only query. Search text and field
// terms aren't covered: DuckDB doesn't split words the way Typesense does.
export function conditions(query: Query): Map<Part | 'author_names', string> {
  if (query.q || query.terms.length > 0) {
    throw new Error('The DuckDB comparison covers filter-only queries.');
  }
  const parts = new Map<Part | 'author_names', string>();
  const add = (part: Part | 'author_names', condition: string | null) => {
    if (condition) {
      parts.set(part, condition);
    }
  };
  for (const key of Object.keys(COLUMNS).concat('subject') as FilterKey[]) {
    add(key, filterCondition(query, key));
  }
  add('notice_years', yearCondition('notice_year', query.noticeYears));
  add('paper_years', yearCondition('paper_year', query.paperYears));
  add('revisions', query.revisions === 'exclude' ? 'NOT is_revision' : null);
  add('editorial_staff', query.editorialStaff === 'exclude' ? 'NOT has_editorial_staff_author' : null);
  for (const name of query.authorNames) {
    add('author_names', [parts.get('author_names'), `list_contains(list_transform(authors, lambda a: name_key(a)), name_key(${sql(name)}))`].filter(Boolean).join(' AND '));
  }
  return parts;
}

// Spec 002 AC4: a filter that matches any of its values, with a selection, is
// counted without its own setting; one that matches all of them is counted
// with it. The year filters and the two options count without their own setting.
export function countsWithoutOwnSetting(query: Query, part: Part): boolean {
  switch (part) {
    case 'notice_years':
      return query.noticeYears.from !== null || query.noticeYears.to !== null;
    case 'paper_years':
      return query.paperYears.from !== null || query.paperYears.to !== null;
    case 'revisions':
      return query.revisions === 'exclude';
    case 'editorial_staff':
      return query.editorialStaff === 'exclude';
    default: {
      const { include, exclude, match } = query.filters[part];
      return (include.length > 0 || exclude.length > 0) && !(match === 'all' && include.length > 0);
    }
  }
}

export const where = (conditionList: string[]) => (conditionList.length > 0 ? conditionList.join(' AND ') : 'true');

// Records per value of one field, among the records that match the conditions.
export async function fieldCounts(snapshot: Snapshot, field: string, conditionList: string[]): Promise<Map<string, number>> {
  const values = LIST_FIELDS.has(field) ? `unnest(${field})` : `CAST(${field} AS VARCHAR)`;
  const rows = await snapshot.rows<{ value: string; count: number }>(
    `SELECT value, count(DISTINCT record_id)::INTEGER AS count
     FROM (SELECT record_id, ${values} AS value FROM docs WHERE ${where(conditionList)})
     WHERE value IS NOT NULL GROUP BY value`,
  );
  return new Map(rows.map(({ value, count }) => [value, count]));
}
