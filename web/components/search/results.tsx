import Link from 'next/link';
import { CloseIcon } from '@/components/icons';
import { ui } from '@/components/ui';
import { formatDataDate } from '@/lib/format/dates';
import { formatNumber } from '@/lib/format/numbers';
import { issueUrl } from '@/lib/links';
import { citation, describeQuery, totalPhrase } from '@/lib/query/describe';
import { SORTS, effectiveSort, type Query, type Sort } from '@/lib/query/types';
import { exportHref, queryHref, serializeQuery } from '@/lib/query/url';
import type { SearchOk } from '@/lib/search/types';
import { ResultItem } from './result-item';
import { SortSelect } from './sort-select';
import { Toolbar } from './toolbar';

// Links that change the search don't prefetch, so scrolling past them doesn't
// start searches or use up the visitor's rate limit (decision record 003).
const searchLink = { prefetch: false } as const;

function Pagination({ query, result }: { query: Query; result: SearchOk }) {
  const { page, pageCount, perPage, found } = result;
  const to = (target: number) => queryHref({ ...query, page: target });
  const first = (page - 1) * perPage + 1;
  const last = Math.min(found, page * perPage);
  const step = (label: string, target: number, enabled: boolean) =>
    enabled ? (
      <Link href={to(target)} className={ui.btn} {...searchLink}>
        {label}
      </Link>
    ) : (
      <span className={ui.btnDisabled} aria-disabled="true">
        {label}
      </span>
    );
  return (
    <nav aria-label="Result pages" className="flex flex-wrap items-center gap-2 pt-1">
      {step('First', 1, page > 1)}
      {step('Previous', page - 1, page > 1)}
      <span className="px-1.5 text-sm text-ink-700 tabular-nums">
        Page {formatNumber(page)} of {formatNumber(pageCount)} · {formatNumber(first)}–{formatNumber(last)} of {formatNumber(found)}
      </span>
      {step('Next', page + 1, page < pageCount)}
      {step('Last', pageCount, page < pageCount)}
    </nav>
  );
}

function NoResults({ query, searchUrl, dataDate }: { query: Query; searchUrl: string; dataDate: string | null }) {
  const summary = describeQuery(query);
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-dashed border-ink-300 p-7">
      <p className="text-lg font-bold">Nothing matches this search.</p>
      <p className="text-ink-700">{summary.sentence}</p>
      <p className="text-sm text-ink-700">Remove one part to widen it:</p>
      <div className="flex flex-wrap gap-2">
        {summary.parts.map(
          (part) =>
            part.remove && (
              <Link key={part.text} href={queryHref(part.remove)} className={ui.btn} {...searchLink}>
                Remove “{part.text}”
              </Link>
            ),
        )}
      </div>
      <p className="mt-1 text-[13px] text-ink-600">
        Think the search got it wrong?{' '}
        <a href={issueUrl({ title: 'Problem with the search', context: `Search link: ${searchUrl}`, dataDate: dataDate ? formatDataDate(dataDate) : undefined })} target="_blank" rel="noopener">
          Open an issue on GitHub
        </a>
        .
      </p>
    </div>
  );
}

export function Results({
  query,
  result,
  searchUrl,
  dataDate,
}: {
  query: Query;
  result: SearchOk;
  // This search's full address, for the issue link.
  searchUrl: string;
  dataDate: string | null;
}) {
  const summary = describeQuery(query);
  const isDefault = serializeQuery({ ...query, page: 1 }) === '';
  const sortHrefs = Object.fromEntries(SORTS.map((sort) => [sort, queryHref({ ...query, sort, page: 1 })])) as Record<Sort, string>;
  const pastTheEnd = result.found > 0 && result.records.length === 0;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-2.5">
        <h1 className="text-[30px] leading-[1.2] font-extrabold tracking-[-0.015em] tabular-nums">{totalPhrase(result.totals)}</h1>
        <div className="flex flex-wrap items-center gap-1.5">
          {summary.parts.map((part) =>
            part.remove ? (
              <span key={part.text} className={ui.chip}>
                {part.text}
                <Link href={queryHref(part.remove)} aria-label={`Remove “${part.text}”`} className={ui.chipRemove} {...searchLink}>
                  <CloseIcon />
                </Link>
              </span>
            ) : (
              <span key={part.text} className={ui.chipFixed}>
                {part.text}
              </span>
            ),
          )}
          {!isDefault && (
            <Link href="/" className={`${ui.link} ml-1`} {...searchLink}>
              Reset to defaults
            </Link>
          )}
        </div>
        {query.authorNames.length > 0 && (
          <div role="note" className="rounded-md border border-[#e3c164] bg-[#fff5d9] px-3.5 py-2.5 text-[13.5px] leading-[1.45] text-[#4a3300]">
            <p>
              {/* The design said "exactly as written"; AC14 now ignores capitals, accents and punctuation. */}
              <strong className="font-bold">Name matches only.</strong> These records list the name as written, ignoring capitals, accents and
              punctuation.
              Different people can share a name, and the same person may appear under other spellings or with initials.
            </p>
          </div>
        )}
        {result.closeSpellings && (
          <p className={ui.note}>
            No exact matches for “{query.q}” with these filters. Showing close spellings, highlighted.
          </p>
        )}
      </div>

      <Toolbar
        sort={
          // An identifier lookup always lists the newest notice first.
          <SortSelect value={result.lookup ? 'newest' : effectiveSort(query)} hrefs={sortHrefs} hasText={Boolean(query.q) && !result.lookup} />
        }
        citation={dataDate ? citation({ query, totals: result.totals, dataDate, url: searchUrl }) : ''}
        downloadHref={result.found > 0 ? exportHref(query) : undefined}
      />

      {result.found === 0 && <NoResults query={query} searchUrl={searchUrl} dataDate={dataDate} />}
      {pastTheEnd && (
        <p className={ui.note}>
          There are only {formatNumber(result.pageCount)} pages of results.{' '}
          <Link href={queryHref({ ...query, page: result.pageCount })} {...searchLink}>
            Go to the last page
          </Link>
          .
        </p>
      )}

      {result.records.length > 0 && (
        <ol className="list-none">
          {result.records.map((record) => (
            <ResultItem key={record.recordId} record={record} query={query} lookup={result.lookup} />
          ))}
        </ol>
      )}
      {result.found > 0 && <Pagination query={query} result={result} />}
    </div>
  );
}
