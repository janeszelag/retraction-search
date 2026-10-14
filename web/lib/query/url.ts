// Reads a query from a URL and writes it back (spec 002 AC16). Writing always
// gives the same form for the same query, and the default view has no parameters.
import {
  DEFAULT_NOTICE_TYPE,
  FILTER_KEYS,
  LIST_FILTER_KEYS,
  SORTS,
  TERM_FIELDS,
  defaultQuery,
  isDefaultSort,
  type FieldTerm,
  type Query,
  type Sort,
  type YearRange,
} from './types';

// Limits that keep a hand-made URL from building a huge search. Generous
// compared with what the page lets anyone select.
export const LIMITS = {
  textLength: 1000,
  terms: 10,
  authorNames: 10,
  valuesPerFilter: 50,
} as const;

// What Next.js passes a page as searchParams, or a URLSearchParams.
export type SearchParamsInput = URLSearchParams | Record<string, string | string[] | undefined>;

function toSearchParams(input: SearchParamsInput): URLSearchParams {
  if (input instanceof URLSearchParams) {
    return input;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    for (const entry of [value ?? []].flat()) {
      params.append(key, entry);
    }
  }
  return params;
}

// Trims, collapses runs of spaces, and drops empty or over-long text.
function cleanText(value: string): string | null {
  const text = value.trim().replace(/\s+/g, ' ');
  return text !== '' && text.length <= LIMITS.textLength ? text : null;
}

function texts(params: URLSearchParams, key: string, limit: number): string[] {
  const values: string[] = [];
  for (const raw of params.getAll(key)) {
    const text = cleanText(raw);
    if (text !== null && !values.includes(text) && values.length < limit) {
      values.push(text);
    }
  }
  return values;
}

// A year with four digits, or null.
function year(params: URLSearchParams, key: string): number | null {
  const value = params.get(key)?.trim() ?? '';
  return /^\d{4}$/.test(value) ? Number(value) : null;
}

// A range whose ends are the wrong way round is turned around.
function yearRange(params: URLSearchParams, prefix: string): YearRange {
  const from = year(params, `${prefix}_from`);
  const to = year(params, `${prefix}_to`);
  return from !== null && to !== null && from > to ? { from: to, to: from } : { from, to };
}

export function parseQuery(input: SearchParamsInput): Query {
  const params = toSearchParams(input);
  const query = defaultQuery();

  query.q = cleanText(params.get('q') ?? '') ?? '';

  // Field terms keep the order of the rows in the URL.
  const termKeys = new Map<string, Omit<FieldTerm, 'words'>>(
    TERM_FIELDS.flatMap((field) => [
      [`in_${field}`, { field, exclude: false }],
      [`not_in_${field}`, { field, exclude: true }],
    ]),
  );
  for (const [key, value] of params) {
    const kind = termKeys.get(key);
    const words = cleanText(value);
    if (
      kind &&
      words !== null &&
      query.terms.length < LIMITS.terms &&
      !query.terms.some((term) => term.field === kind.field && term.exclude === kind.exclude && term.words === words)
    ) {
      query.terms.push({ ...kind, words });
    }
  }
  for (const field of TERM_FIELDS) {
    if (params.get(`in_${field}_match`) === 'all') {
      query.termMatch[field] = 'all';
    }
  }

  query.authorNames = texts(params, 'author_name', LIMITS.authorNames);

  for (const key of FILTER_KEYS) {
    const include = texts(params, key, LIMITS.valuesPerFilter);
    const exclude = texts(params, `not_${key}`, LIMITS.valuesPerFilter);
    const selection = query.filters[key];
    if (key === 'type') {
      // Retractions only, unless the URL says otherwise; type=all selects every type.
      if (include.includes('all')) {
        selection.include = [];
        selection.exclude = [];
        continue;
      }
      if (include.length === 0 && exclude.length === 0) {
        continue;
      }
    }
    // A value both included and excluded counts as excluded.
    selection.exclude = exclude;
    selection.include = include.filter((value) => !exclude.includes(value));
    if (LIST_FILTER_KEYS.includes(key) && params.get(`${key}_match`) === 'all') {
      selection.match = 'all';
    }
  }

  query.noticeYears = yearRange(params, 'notice');
  query.paperYears = yearRange(params, 'paper');
  query.revisions = params.get('revisions') === 'include' ? 'include' : 'exclude';
  query.editorialStaff = params.get('editorial_staff') === 'exclude' ? 'exclude' : 'include';

  const sort = params.get('sort');
  query.sort = SORTS.includes(sort as Sort) ? (sort as Sort) : null;
  // A sort that gives the default order isn't part of the canonical form.
  if (isDefaultSort(query)) {
    query.sort = null;
  }

  const page = params.get('page')?.trim() ?? '';
  query.page = /^[1-9]\d{0,6}$/.test(page) ? Number(page) : 1;

  return query;
}

function isDefaultNoticeType(query: Query): boolean {
  const { include, exclude } = query.filters.type;
  return include.length === 1 && include[0] === DEFAULT_NOTICE_TYPE && exclude.length === 0;
}

// The query string without its "?", or '' for the default view.
export function serializeQuery(query: Query): string {
  const params = new URLSearchParams();
  const add = (key: string, value: string | number) => params.append(key, String(value));

  if (query.q) {
    add('q', query.q);
  }
  for (const term of query.terms) {
    add(`${term.exclude ? 'not_in' : 'in'}_${term.field}`, term.words);
  }
  for (const name of query.authorNames) {
    add('author_name', name);
  }
  for (const field of TERM_FIELDS) {
    if (query.termMatch[field] === 'all') {
      add(`in_${field}_match`, 'all');
    }
  }

  for (const key of FILTER_KEYS) {
    const selection = query.filters[key];
    if (key === 'type') {
      if (isDefaultNoticeType(query)) {
        continue;
      }
      if (selection.include.length === 0 && selection.exclude.length === 0) {
        add('type', 'all');
        continue;
      }
    }
    for (const value of selection.include) {
      add(key, value);
    }
    for (const value of selection.exclude) {
      add(`not_${key}`, value);
    }
    if (selection.match === 'all' && LIST_FILTER_KEYS.includes(key)) {
      add(`${key}_match`, 'all');
    }
  }

  if (query.revisions === 'include') {
    add('revisions', 'include');
  }
  if (query.editorialStaff === 'exclude') {
    add('editorial_staff', 'exclude');
  }
  for (const [prefix, range] of [
    ['notice', query.noticeYears],
    ['paper', query.paperYears],
  ] as const) {
    if (range.from !== null) {
      add(`${prefix}_from`, range.from);
    }
    if (range.to !== null) {
      add(`${prefix}_to`, range.to);
    }
  }
  if (query.sort !== null && !isDefaultSort(query)) {
    add('sort', query.sort);
  }
  if (query.page > 1) {
    add('page', query.page);
  }
  return params.toString();
}

// "/?…" for a query, or "/" for the default view.
export function queryHref(query: Query): string {
  const search = serializeQuery(query);
  return search ? `/?${search}` : '/';
}
