// Turns a query into one Typesense multi_search request (plan 002, "The query").
// Pure: no network, so every case is unit-tested.
import { identifierLookup, type IdentifierLookup } from './identifier';
import { parseSubjectValue } from './subjects';
import { FILTER_KEYS, LIST_FILTER_KEYS, TERM_FIELDS, effectiveSort, type FilterKey, type Query, type TermField } from './types';

export const COLLECTION = 'retractions';
export const PER_PAGE = 20;
// Small filters return every value; journals and publishers return their top values,
// and their search box finds the rest (spec 002 AC6).
export const SMALL_FACET_LIMIT = 300;
export const LONG_FACET_LIMIT = 40;
// Marks matched words. Private-use characters never occur in the data, so the
// page can split on them without inserting any HTML (plan 002, "Highlighting").
export const HIGHLIGHT_START = '';
export const HIGHLIGHT_END = '';

const QUERY_BY = 'title,authors,institutions,journal,publisher';
// Two typos in titles and journals, one in author names, institutions and
// publishers, in QUERY_BY's order (spike S6).
const NUM_TYPOS = '2,1,1,2,1';
// With typos on for every search, results and counts agree when a search has
// no exact match (spike S6).
const TYPOS_ALWAYS_THRESHOLD = 1_000_000;

const TERM_FIELD_NAMES: Record<TermField, string> = {
  title: 'title',
  author: 'authors',
  institution: 'institutions',
  journal: 'journal',
  publisher: 'publisher',
};

const FILTER_FIELDS: Record<Exclude<FilterKey, 'subject'>, string> = {
  type: 'notice_type',
  reason: 'reasons',
  country: 'countries',
  article_type: 'article_types',
  journal: 'journal',
  publisher: 'publisher',
  paywalled: 'paywalled',
};

// Each part of the filter that has counts of its own.
export type CountPart = FilterKey | 'notice_years' | 'paper_years' | 'revisions' | 'editorial_staff';

export const COUNT_FIELDS: Record<CountPart, string[]> = {
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

const LONG_PARTS: CountPart[] = ['journal', 'publisher'];
const COUNT_PARTS = Object.keys(COUNT_FIELDS) as CountPart[];

export interface TypesenseSearch {
  collection: string;
  q: string;
  query_by?: string;
  num_typos?: string;
  drop_tokens_threshold?: number;
  typo_tokens_threshold?: number;
  filter_by?: string;
  facet_by?: string;
  facet_query?: string;
  max_facet_values?: number;
  sort_by?: string;
  include_fields?: string;
  per_page: number;
  page?: number;
  highlight_fields?: string;
  highlight_full_fields?: string;
  highlight_start_tag?: string;
  highlight_end_tag?: string;
  enable_highlight_v1?: boolean;
}

// What each search in the request is for, in the same order.
export type SearchRole =
  // The page of results, the total by notice type, and counts for filters without a selection.
  | { kind: 'results'; fields: string[] }
  // Counts that ignore one part of the filter (part: null for none).
  | { kind: 'counts'; part: CountPart | null; fields: string[] }
  // Counts for the selected journals or publishers, which may be outside the top values.
  | { kind: 'selected'; part: 'journal' | 'publisher' }
  // How many records match the search text exactly, to tell when Typesense fell back to close spellings.
  | { kind: 'exact' };

export interface SearchPlan {
  searches: TypesenseSearch[];
  roles: SearchRole[];
  lookup: IdentifierLookup | null;
}

// Values go inside backtick literals, so commas and parentheses are safe. No
// value in the data holds a backtick, so one in a URL can only be dropped.
function literal(value: string): string {
  return `\`${value.replaceAll('`', '')}\``;
}

function anyOf(field: string, values: string[]): string {
  return `${field}:=[${values.map(literal).join(', ')}]`;
}

function noneOf(field: string, values: string[]): string {
  return `${field}:!=[${values.map(literal).join(', ')}]`;
}

const grouped = (clauses: string[], operator: '&&' | '||') =>
  clauses.length > 1 ? `(${clauses.join(` ${operator} `)})` : clauses[0];

function filterClause(key: FilterKey, query: Query): string | null {
  const { include, exclude, match } = query.filters[key];
  const clauses: string[] = [];
  if (key === 'subject') {
    // A subject value is a category code or a subject, each with its own field.
    const field = (value: string) => (parseSubjectValue(value).kind === 'category' ? 'subject_categories' : 'subjects');
    if (include.length > 0) {
      if (match === 'all') {
        clauses.push(...include.map((value) => `${field(value)}:=${literal(value)}`));
      } else {
        const categories = include.filter((value) => field(value) === 'subject_categories');
        const subjects = include.filter((value) => field(value) === 'subjects');
        clauses.push(
          grouped(
            [
              ...(categories.length > 0 ? [anyOf('subject_categories', categories)] : []),
              ...(subjects.length > 0 ? [anyOf('subjects', subjects)] : []),
            ],
            '||',
          ),
        );
      }
    }
    for (const [fieldName, values] of [
      ['subject_categories', exclude.filter((value) => field(value) === 'subject_categories')],
      ['subjects', exclude.filter((value) => field(value) === 'subjects')],
    ] as const) {
      if (values.length > 0) {
        clauses.push(noneOf(fieldName, values));
      }
    }
  } else {
    const field = FILTER_FIELDS[key];
    if (include.length > 0) {
      if (match === 'all' && LIST_FILTER_KEYS.includes(key)) {
        clauses.push(...include.map((value) => `${field}:=${literal(value)}`));
      } else {
        clauses.push(anyOf(field, include));
      }
    }
    if (exclude.length > 0) {
      clauses.push(noneOf(field, exclude));
    }
  }
  return clauses.length > 0 ? clauses.join(' && ') : null;
}

function yearClause(field: string, range: { from: number | null; to: number | null }): string | null {
  const clauses = [
    ...(range.from !== null ? [`${field}:>=${range.from}`] : []),
    ...(range.to !== null ? [`${field}:<=${range.to}`] : []),
  ];
  return clauses.length > 0 ? clauses.join(' && ') : null;
}

// Words split where Typesense splits them: at spaces, and also at hyphens and
// slashes in the fields the load gives token_separators (all but author names).
const words = (text: string, field: TermField) =>
  text
    .replaceAll('`', '')
    .split(field === 'author' ? /\s+/ : /[\s/-]+/)
    .filter(Boolean);

// A term matches when all its words appear somewhere in the field (spec 002 AC11).
function termsClause(query: Query): string | null {
  const clauses: string[] = [];
  for (const field of TERM_FIELDS) {
    const name = TERM_FIELD_NAMES[field];
    const included = query.terms.filter((term) => term.field === field && !term.exclude && words(term.words, field).length > 0);
    if (included.length > 0) {
      const matches = included.map((term) => `${name}:${literal(words(term.words, field).join(' '))}`);
      clauses.push(query.termMatch[field] === 'all' ? matches.join(' && ') : grouped(matches, '||'));
    }
    // An excluded term keeps records missing any of its words. Typesense can't
    // negate a group, so the negation is spelled out word by word (spike S1).
    for (const term of query.terms.filter((candidate) => candidate.field === field && candidate.exclude)) {
      const termWords = words(term.words, field);
      if (termWords.length > 0) {
        clauses.push(grouped(termWords.map((word) => `${name}:!${literal(word)}`), '||'));
      }
    }
  }
  return clauses.length > 0 ? clauses.join(' && ') : null;
}

// Every clause of the filter, by the part it belongs to.
function filterParts(query: Query): Map<CountPart | 'terms' | 'author_names', string> {
  const parts = new Map<CountPart | 'terms' | 'author_names', string>();
  const add = (part: CountPart | 'terms' | 'author_names', clause: string | null) => {
    if (clause !== null) {
      parts.set(part, clause);
    }
  };
  // In the order the summary reads: the notice types and the two options first.
  add('type', filterClause('type', query));
  add('revisions', query.revisions === 'exclude' ? 'is_revision:=false' : null);
  add('editorial_staff', query.editorialStaff === 'exclude' ? 'has_editorial_staff_author:=false' : null);
  for (const key of FILTER_KEYS.filter((key) => key !== 'type')) {
    add(key, filterClause(key, query));
  }
  add('notice_years', yearClause('notice_year', query.noticeYears));
  add('paper_years', yearClause('paper_year', query.paperYears));
  add('terms', termsClause(query));
  // Each selected name must be listed. Matches ignore capitals and accents (spec 002 AC14).
  add('author_names', query.authorNames.length > 0 ? query.authorNames.map((name) => `authors:=${literal(name)}`).join(' && ') : null);
  return parts;
}

function joinFilter(clauses: string[]): string | undefined {
  return clauses.length > 0 ? clauses.join(' && ') : undefined;
}

// Whether a part's counts must ignore the part's own setting (spec 002 AC4).
// A filter that matches all of its values counts with its own setting, so its
// counts come from the main search.
function hasOwnCounts(query: Query, part: CountPart): boolean {
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
      const selection = query.filters[part];
      const selected = selection.include.length > 0 || selection.exclude.length > 0;
      return selected && !(selection.match === 'all' && selection.include.length > 0);
    }
  }
}

const SORT_BY = {
  relevance: '_text_match:desc,notice_date:desc,record_id:desc',
  newest: 'notice_date:desc,record_id:desc',
  oldest: 'notice_date:asc,record_id:asc',
  paper_newest: 'paper_date:desc,record_id:desc',
  paper_oldest: 'paper_date:asc,record_id:asc',
} as const;

function lookupClause(lookup: IdentifierLookup): string {
  return lookup.kind === 'doi'
    ? `notice_doi:=${literal(lookup.value)} || paper_doi:=${literal(lookup.value)}`
    : `notice_pubmed_id:=${lookup.value} || paper_pubmed_id:=${lookup.value}`;
}

const highlighting = {
  highlight_fields: 'title,authors',
  highlight_full_fields: 'title,authors',
  highlight_start_tag: HIGHLIGHT_START,
  highlight_end_tag: HIGHLIGHT_END,
  enable_highlight_v1: false,
};

// The search-text part of every search for a query.
function textParams(query: Query, typos: 'fallback' | 'always') {
  return query.q
    ? {
        q: query.q,
        query_by: QUERY_BY,
        num_typos: NUM_TYPOS,
        drop_tokens_threshold: 0,
        ...(typos === 'always' ? { typo_tokens_threshold: TYPOS_ALWAYS_THRESHOLD } : {}),
      }
    : { q: '*' };
}

// Finds a long filter's values by name, for its search box (spec 002 AC6):
// the filter's counts search, narrowed with Typesense's facet_query, which
// matches each typed word as the start of a word in the name.
export function toFacetValueSearch(query: Query, part: 'journal' | 'publisher', find: string): TypesenseSearch {
  const parts = filterParts(query);
  const others = [...parts].filter(([key]) => key !== part).map(([, clause]) => clause);
  return {
    collection: COLLECTION,
    ...textParams(query, 'fallback'),
    filter_by: joinFilter(others),
    facet_by: part,
    facet_query: `${part}:${find.replaceAll('`', '')}`,
    max_facet_values: LONG_FACET_LIMIT,
    per_page: 0,
  };
}

// The value named exactly as typed, ignoring capitals and accents, for names
// so short or common that facet_query ranks them past the top values
// ("Health", "Chem").
export function toExactValueSearch(query: Query, part: 'journal' | 'publisher', find: string): TypesenseSearch {
  const others = [...filterParts(query)].filter(([key]) => key !== part).map(([, clause]) => clause);
  return {
    collection: COLLECTION,
    ...textParams(query, 'fallback'),
    filter_by: joinFilter([...others, anyOf(part, [find])]),
    facet_by: part,
    max_facet_values: 5,
    per_page: 0,
  };
}

export interface PlanOptions {
  // 'fallback': Typesense's default, trying other spellings only when nothing matches exactly.
  // 'always': typos on for every search, used when the results came only from close spellings.
  typos?: 'fallback' | 'always';
}

export function toTypesense(query: Query, { typos = 'fallback' }: PlanOptions = {}): SearchPlan {
  const searches: TypesenseSearch[] = [];
  const roles: SearchRole[] = [];
  const add = (search: Omit<TypesenseSearch, 'collection'>, role: SearchRole) => {
    searches.push({ collection: COLLECTION, ...search });
    roles.push(role);
  };

  // An identifier lookup ignores every other part of the query (spec 002 AC12).
  const lookup = identifierLookup(query.q);
  if (lookup) {
    add(
      {
        q: '*',
        filter_by: lookupClause(lookup),
        facet_by: 'notice_type',
        max_facet_values: SMALL_FACET_LIMIT,
        sort_by: SORT_BY.newest,
        per_page: PER_PAGE,
        page: query.page,
      },
      { kind: 'results', fields: ['notice_type'] },
    );
    return { searches, roles, lookup };
  }

  const text = textParams(query, typos);
  const parts = filterParts(query);
  const without = (...omitted: string[]) => [...parts].filter(([part]) => !omitted.includes(part)).map(([, clause]) => clause);
  const own = COUNT_PARTS.filter((part) => hasOwnCounts(query, part));
  const shared = COUNT_PARTS.filter((part) => !own.includes(part));

  // The main search counts notice types for the total, plus every small filter without counts of its own.
  const mainFields = [
    'notice_type',
    ...shared.filter((part) => !LONG_PARTS.includes(part)).flatMap((part) => COUNT_FIELDS[part]),
  ].filter((field, index, all) => all.indexOf(field) === index);
  add(
    {
      ...text,
      filter_by: joinFilter(without()),
      facet_by: mainFields.join(','),
      max_facet_values: SMALL_FACET_LIMIT,
      sort_by: SORT_BY[effectiveSort(query)],
      per_page: PER_PAGE,
      page: query.page,
      ...highlighting,
    },
    { kind: 'results', fields: mainFields },
  );

  const sharedLong = shared.filter((part) => LONG_PARTS.includes(part)).flatMap((part) => COUNT_FIELDS[part]);
  if (sharedLong.length > 0) {
    add(
      { ...text, filter_by: joinFilter(without()), facet_by: sharedLong.join(','), max_facet_values: LONG_FACET_LIMIT, per_page: 0 },
      { kind: 'counts', part: null, fields: sharedLong },
    );
  }

  for (const part of own) {
    const fields = COUNT_FIELDS[part];
    add(
      {
        ...text,
        filter_by: joinFilter(without(part)),
        facet_by: fields.join(','),
        max_facet_values: LONG_PARTS.includes(part) ? LONG_FACET_LIMIT : SMALL_FACET_LIMIT,
        per_page: 0,
      },
      { kind: 'counts', part, fields },
    );
    if (part === 'journal' || part === 'publisher') {
      const { include, exclude } = query.filters[part];
      const selected = [...include, ...exclude];
      add(
        {
          ...text,
          filter_by: joinFilter([...without(part), anyOf(part, selected)]),
          facet_by: part,
          max_facet_values: selected.length,
          per_page: 0,
        },
        { kind: 'selected', part },
      );
    }
  }

  if (query.q && typos === 'fallback') {
    add({ ...text, num_typos: '0', filter_by: joinFilter(without()), per_page: 0 }, { kind: 'exact' });
  }

  return { searches, roles, lookup };
}
