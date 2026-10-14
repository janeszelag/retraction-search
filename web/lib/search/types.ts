// What a search gives the page. Shared by server and client code, so it holds
// no keys and no server-only imports.
import type { IdentifierLookup } from '../query/identifier';

// A piece of text, marked when it matched the search. Pages render marked
// pieces as <mark> elements; nothing is inserted as HTML.
export interface Segment {
  text: string;
  mark: boolean;
}

export interface ResultRecord {
  recordId: number;
  title: string;
  titleSegments: Segment[];
  authors: string[];
  // One list of segments per author, in the same order.
  authorSegments: Segment[][];
  // Positions of the authors whose names matched the search text.
  matchedAuthors: number[];
  institutions: string[];
  journal: string;
  publisher: string;
  countries: string[];
  subjects: string[];
  subjectCategories: string[];
  articleTypes: string[];
  reasons: string[];
  noticeType: string;
  paywalled: string;
  isRevision: boolean;
  hasEditorialStaffAuthor: boolean;
  // Unix seconds, negative before 1970.
  noticeDate: number;
  noticeYear: number;
  paperDate: number;
  paperYear: number;
  noticeDoi: string | null;
  paperDoi: string | null;
  noticePubmedId: number | null;
  paperPubmedId: number | null;
  urls: string[];
  // How many records list each URL, in the same order as urls.
  urlRecordCounts: number[];
  notes: string | null;
  // Values as Retraction Watch published them, where the cleaning changed them.
  original: Record<string, string>;
}

export interface ValueCount {
  value: string;
  count: number;
}

// Counts per Typesense field: notice_type, reasons, subjects, subject_categories,
// countries, article_types, journal, publisher, paywalled, notice_year,
// paper_year, is_revision and has_editorial_staff_author. Each follows spec 002
// AC4: a filter that matches any of its values is counted without its own setting.
export type FacetCounts = Record<string, ValueCount[]>;

export interface SearchOk {
  status: 'ok';
  lookup: IdentifierLookup | null;
  // True when nothing matched the search text exactly, so the results are close spellings (AC13).
  closeSpellings: boolean;
  found: number;
  // Records found, by notice type (AC17).
  totals: Record<string, number>;
  page: number;
  pageCount: number;
  perPage: number;
  records: ResultRecord[];
  counts: FacetCounts;
}

export interface SearchUnavailable {
  status: 'unavailable';
}

export type SearchResult = SearchOk | SearchUnavailable;

// The meta document the load writes (plan 002, "Loading").
export interface Meta {
  dataDate: string;
  commit: string;
  documents: number;
  // Full names for journal and publisher values Typesense cut at 255 bytes.
  cutNames: { journal: Record<string, string>; publisher: Record<string, string> };
}
