// Everything a search URL can say (plan 002, "The query").

export type Match = 'any' | 'all';

// Filters, by their URL name. Values are the values in the data, so a URL is readable.
export const FILTER_KEYS = ['type', 'reason', 'subject', 'country', 'article_type', 'journal', 'publisher', 'paywalled'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

// Filters where one record can hold several values; only these can match all of
// their included values (spec 002 AC5). A subject value is either a category
// code ("BLS") or a subject with its code ("BLS: Neuroscience").
export const LIST_FILTER_KEYS: readonly FilterKey[] = ['reason', 'subject', 'country', 'article_type'];

export interface FilterSelection {
  include: string[];
  exclude: string[];
  match: Match;
}

// Fields a field term can search, by their URL name.
export const TERM_FIELDS = ['title', 'author', 'institution', 'journal', 'publisher'] as const;
export type TermField = (typeof TERM_FIELDS)[number];

// One "search in a field" row: all its words must appear in the field (spec 002 AC11).
export interface FieldTerm {
  field: TermField;
  words: string;
  exclude: boolean;
}

export interface YearRange {
  from: number | null;
  to: number | null;
}

export const SORTS = ['relevance', 'newest', 'oldest', 'paper_newest', 'paper_oldest'] as const;
export type Sort = (typeof SORTS)[number];

export interface Query {
  q: string;
  terms: FieldTerm[];
  // How each field's included terms combine. Excluded terms always each exclude.
  termMatch: Record<TermField, Match>;
  // Selected author names; a record must list every one (spec 002 AC14).
  authorNames: string[];
  filters: Record<FilterKey, FilterSelection>;
  noticeYears: YearRange;
  paperYears: YearRange;
  revisions: 'exclude' | 'include';
  editorialStaff: 'include' | 'exclude';
  // null means the default: relevance when there's search text, newest notice first otherwise.
  sort: Sort | null;
  // Starts at 1.
  page: number;
}

// Only retractions are selected by default (spec 002 AC2).
export const DEFAULT_NOTICE_TYPE = 'Retraction';

export function emptySelection(): FilterSelection {
  return { include: [], exclude: [], match: 'any' };
}

export function defaultQuery(): Query {
  const filters = Object.fromEntries(FILTER_KEYS.map((key) => [key, emptySelection()])) as Record<FilterKey, FilterSelection>;
  filters.type.include = [DEFAULT_NOTICE_TYPE];
  return {
    q: '',
    terms: [],
    termMatch: Object.fromEntries(TERM_FIELDS.map((field) => [field, 'any'])) as Record<TermField, Match>,
    authorNames: [],
    filters,
    noticeYears: { from: null, to: null },
    paperYears: { from: null, to: null },
    revisions: 'exclude',
    editorialStaff: 'include',
    sort: null,
    page: 1,
  };
}

// The sort that applies when none is chosen (spec 002 AC19).
export function defaultSort(query: Pick<Query, 'q'>): Sort {
  return query.q ? 'relevance' : 'newest';
}

// Whether the chosen sort gives the same order as the default. Relevance needs
// search text, so without any it means the default too.
export function isDefaultSort(query: Pick<Query, 'q' | 'sort'>): boolean {
  return query.sort === null || query.sort === defaultSort(query) || (query.sort === 'relevance' && !query.q);
}

// The sort the results use.
export function effectiveSort(query: Pick<Query, 'q' | 'sort'>): Sort {
  return isDefaultSort(query) ? defaultSort(query) : (query.sort as Sort);
}
