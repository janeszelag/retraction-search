import { FilterDrawer } from '@/components/filters/filter-drawer';
import { DimWhilePending, PendingProvider } from '@/components/filters/pending';
import { FilterSidebar } from '@/components/filters/sidebar';
import { SearchLimitReached } from '@/components/search/limit-reached';
import { Results } from '@/components/search/results';
import { SearchHeader } from '@/components/search/search-header';
import { Unavailable } from '@/components/search/unavailable';
import { ui } from '@/components/ui';
import { DEFAULT_NOTICE_TYPE, FILTER_KEYS, type Query } from '@/lib/query/types';
import { describeQuery, resultsAnnouncement } from '@/lib/query/describe';
import { parseQuery, queryHref } from '@/lib/query/url';
import { siteOrigin } from '@/lib/server/origin';
import { checkLimit } from '@/lib/server/rate-limit';
import { getMeta, runSearch } from '@/lib/server/search';

// How many filter choices differ from the defaults, for the phone's Filters button.
function activeFilters(query: Query): number {
  let count = 0;
  for (const key of FILTER_KEYS) {
    const { include, exclude } = query.filters[key];
    const isDefault = key === 'type' && include.length === 1 && include[0] === DEFAULT_NOTICE_TYPE && exclude.length === 0;
    if (!isDefault) {
      count += include.length + exclude.length;
    }
  }
  for (const range of [query.noticeYears, query.paperYears]) {
    count += range.from !== null || range.to !== null ? 1 : 0;
  }
  return count + (query.revisions === 'include' ? 1 : 0) + (query.editorialStaff === 'exclude' ? 1 : 0);
}

// The search page (spec 002). A server component: Next.js runs it on the
// server for every request, so the results and counts arrive in the first
// HTML, and the Typesense key never leaves the server (AC16, AC27).
export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseQuery(await searchParams);
  // Each search page counts toward the visitor's limit; over it, no search runs (AC28).
  const [limit, meta] = await Promise.all([checkLimit('searches'), getMeta()]);
  const result = limit.status === 'ok' ? await runSearch(query, undefined, meta) : null;
  const href = queryHref(query);
  const lastYear = meta ? Number(meta.dataDate.slice(0, 4)) : new Date().getUTCFullYear();
  // Identifier lookups ignore the filters, so they're not offered.
  const filters = result?.status === 'ok' && !result.lookup ? <FilterSidebar query={query} counts={result.counts} lastYear={lastYear} /> : null;
  // Over the limit, the notice is an alert and speaks for itself.
  const announcement =
    result?.status === 'ok' ? resultsAnnouncement(result) : limit.status === 'limited' ? '' : 'Search is unavailable right now.';

  return (
    <PendingProvider>
      <SearchHeader query={query} dataDate={meta?.dataDate ?? null} />
      <div className={`${ui.wrap} ${ui.cols} items-start pt-6 pb-12`}>
        <aside className={`${ui.sideCol} hidden cols:block`} aria-label="Filters">
          {filters}
        </aside>
        {/* "Skip to results" in the header lands here (AC32). */}
        <main id="results" tabIndex={-1} className={`${ui.mainCol} flex flex-col gap-3.5 focus:outline-none`}>
          {/* What screen readers hear when the results change. It stays outside the part
              marked busy while a search loads, and the same element across searches, so
              each change is announced (AC32). */}
          <p role="status" aria-atomic="true" className="sr-only">
            {announcement}
          </p>
          {filters && <FilterDrawer active={activeFilters(query)}>{filters}</FilterDrawer>}
          {limit.status === 'limited' ? (
            <SearchLimitReached retryAfter={limit.retryAfter} sentence={describeQuery(query).sentence} retryHref={href} />
          ) : result?.status === 'ok' ? (
            <DimWhilePending>
              <Results query={query} result={result} searchUrl={`${await siteOrigin()}${href}`} dataDate={meta?.dataDate ?? null} />
            </DimWhilePending>
          ) : (
            <Unavailable retryHref={href} />
          )}
        </main>
      </div>
    </PendingProvider>
  );
}
