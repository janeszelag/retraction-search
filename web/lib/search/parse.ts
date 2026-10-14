// Turns Typesense's multi_search results into the page's data. Pure, so it's
// tested with recorded responses.
import { HIGHLIGHT_END, HIGHLIGHT_START, PER_PAGE, type SearchPlan } from '../query/typesense';
import type { Query } from '../query/types';
import type { FacetCounts, Meta, ResultRecord, SearchOk, Segment, ValueCount } from './types';

// The parts of a Typesense response this site reads.
export interface TypesenseFacet {
  field_name: string;
  counts: { value: string; count: number }[];
}

export interface TypesenseHighlightValue {
  value?: string;
  snippet?: string;
  matched_tokens?: string[];
}

export interface TypesenseHit {
  document: Record<string, unknown>;
  highlight?: Record<string, TypesenseHighlightValue | TypesenseHighlightValue[]>;
}

export interface TypesenseResult {
  found?: number;
  hits?: TypesenseHit[];
  facet_counts?: TypesenseFacet[];
  error?: string;
  code?: number;
}

// Splits marked text into plain and matched pieces.
export function segments(marked: string): Segment[] {
  const pieces: Segment[] = [];
  let mark = false;
  for (const part of marked.split(new RegExp(`(${HIGHLIGHT_START}|${HIGHLIGHT_END})`))) {
    if (part === HIGHLIGHT_START) {
      mark = true;
    } else if (part === HIGHLIGHT_END) {
      mark = false;
    } else if (part !== '') {
      pieces.push({ text: part, mark });
    }
  }
  return pieces;
}

const plain = (text: string): Segment[] => (text === '' ? [] : [{ text, mark: false }]);

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);
const numbers = (value: unknown): number[] => (Array.isArray(value) ? value.map(Number) : []);
const optionalString = (value: unknown) => (typeof value === 'string' ? value : null);
const optionalNumber = (value: unknown) => (typeof value === 'number' ? value : null);

export function parseRecord(hit: TypesenseHit): ResultRecord {
  const doc = hit.document;
  const title = String(doc.title ?? '');
  const authors = strings(doc.authors);

  const titleHighlight = hit.highlight?.title;
  const titleSegments =
    titleHighlight && !Array.isArray(titleHighlight) && titleHighlight.value !== undefined
      ? segments(titleHighlight.value)
      : plain(title);

  // Typesense gives one highlight per author, in the same order as the authors.
  const authorHighlights = hit.highlight?.authors;
  const matchedAuthors: number[] = [];
  const authorSegments = authors.map((author, index) => {
    const highlight = Array.isArray(authorHighlights) ? authorHighlights[index] : undefined;
    if (highlight?.value !== undefined && (highlight.matched_tokens?.length ?? 0) > 0) {
      matchedAuthors.push(index);
      return segments(highlight.value);
    }
    return plain(author);
  });

  return {
    recordId: Number(doc.record_id),
    title,
    titleSegments,
    authors,
    authorSegments,
    matchedAuthors,
    institutions: strings(doc.institutions),
    journal: String(doc.journal ?? ''),
    publisher: String(doc.publisher ?? ''),
    countries: strings(doc.countries),
    subjects: strings(doc.subjects),
    subjectCategories: strings(doc.subject_categories),
    articleTypes: strings(doc.article_types),
    reasons: strings(doc.reasons),
    noticeType: String(doc.notice_type ?? ''),
    paywalled: String(doc.paywalled ?? ''),
    isRevision: doc.is_revision === true,
    hasEditorialStaffAuthor: doc.has_editorial_staff_author === true,
    noticeDate: Number(doc.notice_date),
    noticeYear: Number(doc.notice_year),
    paperDate: Number(doc.paper_date),
    paperYear: Number(doc.paper_year),
    noticeDoi: optionalString(doc.notice_doi),
    paperDoi: optionalString(doc.paper_doi),
    noticePubmedId: optionalNumber(doc.notice_pubmed_id),
    paperPubmedId: optionalNumber(doc.paper_pubmed_id),
    urls: strings(doc.urls),
    urlRecordCounts: numbers(doc.url_record_counts),
    notes: optionalString(doc.notes),
    original: Object.fromEntries(
      Object.entries((doc.original as Record<string, unknown> | undefined) ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
  };
}

function facet(result: TypesenseResult, field: string): ValueCount[] {
  const found = result.facet_counts?.find((candidate) => candidate.field_name === field);
  return found ? found.counts.map(({ value, count }) => ({ value, count })) : [];
}

// Swaps journal and publisher values Typesense cut at 255 bytes for their full names.
function fullNames(field: string, counts: ValueCount[], meta: Meta): ValueCount[] {
  const names = field === 'journal' || field === 'publisher' ? meta.cutNames[field] : undefined;
  return names ? counts.map((entry) => ({ ...entry, value: names[entry.value] ?? entry.value })) : counts;
}

export class SearchResponseError extends Error {}

export function parseSearch({
  query,
  plan,
  results,
  meta,
  closeSpellings,
}: {
  query: Query;
  plan: SearchPlan;
  results: TypesenseResult[];
  meta: Meta;
  closeSpellings: boolean;
}): SearchOk {
  if (results.length !== plan.searches.length) {
    throw new SearchResponseError(`Typesense returned ${results.length} results for ${plan.searches.length} searches.`);
  }
  const failed = results.find((result) => result.error);
  if (failed) {
    throw new SearchResponseError(`Typesense refused a search: ${failed.error}`);
  }

  const main = results[0];
  const found = main.found ?? 0;

  // Each field's counts come from the search that counts it the right way: a
  // part's own counts search when it has one, the main search otherwise.
  const counts: FacetCounts = {};
  plan.roles.forEach((role, index) => {
    if (role.kind === 'results') {
      for (const field of role.fields) {
        counts[field] ??= facet(results[index], field);
      }
    }
  });
  plan.roles.forEach((role, index) => {
    if (role.kind === 'counts') {
      for (const field of role.fields) {
        counts[field] = facet(results[index], field);
      }
    }
  });
  for (const [field, values] of Object.entries(counts)) {
    counts[field] = fullNames(field, values, meta);
  }

  // Selected journals and publishers keep their counts even outside the top
  // values, and show 0 when nothing matches (spec 002 AC6).
  plan.roles.forEach((role, index) => {
    if (role.kind !== 'selected') {
      return;
    }
    const field = role.part;
    const selectedCounts = new Map(fullNames(field, facet(results[index], field), meta).map((entry) => [entry.value, entry.count]));
    const list = counts[field] ?? [];
    const { include, exclude } = query.filters[role.part];
    for (const value of [...include, ...exclude]) {
      const count = selectedCounts.get(value) ?? 0;
      const existing = list.find((entry) => entry.value === value);
      if (existing) {
        existing.count = count;
      } else {
        list.push({ value, count });
      }
    }
    counts[field] = list;
  });

  // The total by notice type always comes from the main search.
  const totals = Object.fromEntries(facet(main, 'notice_type').map(({ value, count }) => [value, count]));

  return {
    status: 'ok',
    lookup: plan.lookup,
    closeSpellings,
    found,
    totals,
    page: query.page,
    pageCount: Math.max(1, Math.ceil(found / PER_PAGE)),
    perPage: PER_PAGE,
    records: (main.hits ?? []).map(parseRecord),
    counts,
  };
}

// True when the search text matched nothing exactly but close spellings did (spike S6).
export function onlyCloseSpellings(plan: SearchPlan, results: TypesenseResult[]): boolean {
  const exact = plan.roles.findIndex((role) => role.kind === 'exact');
  return exact > -1 && (results[exact]?.found ?? 0) === 0 && (results[0]?.found ?? 0) > 0;
}

export function parseMeta(document: Record<string, unknown>): Meta {
  const cut = (document.cut_names ?? {}) as { journal?: Record<string, string>; publisher?: Record<string, string> };
  return {
    dataDate: String(document.data_date),
    commit: String(document.commit),
    documents: Number(document.documents),
    cutNames: { journal: cut.journal ?? {}, publisher: cut.publisher ?? {} },
  };
}
