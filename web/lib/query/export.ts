// The CSV download's requests to Typesense (plan 002, "CSV download"). Pure,
// like the page's mapping, so the download asks for the same records as the page.
import { EXPORT_FIELDS } from '../search/csv';
import { toTypesense, type PlanOptions, type TypesenseSearch } from './typesense';
import type { Query } from './types';

// Typesense's largest page.
export const EXPORT_PER_PAGE = 250;

export interface ExportPlan {
  // The page's main search without counts or highlights. Its `found` is the page's total.
  count: TypesenseSearch;
  // How many records match the search text exactly, to tell when the page showed close spellings.
  exact: TypesenseSearch | null;
  // Without search text, Typesense's export endpoint streams every match in one
  // request. It takes only a filter, so search text needs pages of results instead.
  source: { kind: 'export'; filterBy: string | undefined } | { kind: 'pages'; page: (page: number) => TypesenseSearch };
}

export function toExportPlan(query: Query, options: PlanOptions = {}): ExportPlan {
  const plan = toTypesense(query, options);
  const [main] = plan.searches;
  const exactIndex = plan.roles.findIndex((role) => role.kind === 'exact');
  const text = main.q === '*' ? {} : { query_by: main.query_by, num_typos: main.num_typos, drop_tokens_threshold: main.drop_tokens_threshold };
  const typos = main.typo_tokens_threshold === undefined ? {} : { typo_tokens_threshold: main.typo_tokens_threshold };
  const search = (page: number, perPage: number): TypesenseSearch => ({
    collection: main.collection,
    q: main.q,
    ...text,
    ...typos,
    filter_by: main.filter_by,
    // The page's order, which the tie-breaker keeps from overlapping between pages (spike S3).
    sort_by: main.sort_by,
    include_fields: EXPORT_FIELDS.join(','),
    per_page: perPage,
    page,
  });

  return {
    count: search(1, 0),
    exact: exactIndex > -1 ? plan.searches[exactIndex] : null,
    // An identifier lookup has no search text either: it's a filter on the identifier fields.
    source: main.q === '*' ? { kind: 'export', filterBy: main.filter_by } : { kind: 'pages', page: (page) => search(page, EXPORT_PER_PAGE) },
  };
}
