import { Results } from '@/components/search/results';
import { SearchHeader } from '@/components/search/search-header';
import { Unavailable } from '@/components/search/unavailable';
import { ui } from '@/components/ui';
import { parseQuery, queryHref } from '@/lib/query/url';
import { siteOrigin } from '@/lib/server/origin';
import { getMeta, runSearch } from '@/lib/server/search';

// The search page (spec 002). A server component: Next.js runs it on the
// server for every request, so the results and counts arrive in the first
// HTML, and the Typesense key never leaves the server (AC16, AC27).
export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseQuery(await searchParams);
  const meta = await getMeta();
  const result = await runSearch(query, undefined, meta);
  const href = queryHref(query);

  return (
    <>
      <SearchHeader query={query} dataDate={meta?.dataDate ?? null} />
      <div className={`${ui.wrap} ${ui.cols} items-start pt-6 pb-12`}>
        {/* The filters arrive with task 12. */}
        <aside className={ui.sideCol} aria-label="Filters" />
        <main className={ui.mainCol}>
          {result.status === 'ok' ? (
            <Results query={query} result={result} searchUrl={`${await siteOrigin()}${href}`} dataDate={meta?.dataDate ?? null} />
          ) : (
            <Unavailable retryHref={href} />
          )}
        </main>
      </div>
    </>
  );
}
