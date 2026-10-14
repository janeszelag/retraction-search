'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { ui } from '@/components/ui';
import { formatNumber } from '@/lib/format/numbers';
import { formatWait } from '@/lib/rate-limit';
import { clearFilter, setMatch } from '@/lib/query/changes';
import type { FilterKey, Query } from '@/lib/query/types';
import { queryHref, serializeQuery } from '@/lib/query/url';
import { filterLink, ValueRow } from './value-row';

// The most values a filter lists at once; a find box reaches the rest.
export const MORE_LIMIT = 40;
// Typed names are sent after this pause, so each keystroke isn't a search.
const TYPING_PAUSE_MS = 250;

type RemoteResult = { find: string; values: FacetValue[] } | { find: string; error: 'unavailable' } | { find: string; error: 'limited'; retryAfter: number };

// Asks the site's route handler for values matching the typed text, for
// filters with too many values to send to the page (journals and publishers).
function useRemoteValues(facet: 'journal' | 'publisher' | undefined, find: string, query: Query): RemoteResult | null {
  const [result, setResult] = useState<RemoteResult | null>(null);
  const search = serializeQuery({ ...query, page: 1 });
  const text = find.trim();
  useEffect(() => {
    if (!facet || text.length < 2) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams(search);
        params.set('facet', facet);
        params.set('facet_find', text);
        const response = await fetch(`/api/facet-values?${params}`, { signal: controller.signal });
        if (response.status === 429) {
          setResult({ find: text, error: 'limited', retryAfter: Number(response.headers.get('Retry-After')) || 60 });
          return;
        }
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const body = (await response.json()) as { values: { value: string; count: number }[] };
        setResult({ find: text, values: body.values.map(({ value, count }) => ({ value, label: value, count })) });
      } catch {
        if (!controller.signal.aborted) {
          setResult({ find: text, error: 'unavailable' });
        }
      }
    }, TYPING_PAUSE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [facet, text, search]);
  return result && result.find === text ? result : null;
}

export interface FacetValue {
  value: string;
  label: string;
  count: number;
  // Shown after the box, such as a reason's group color.
  after?: ReactNode;
}

// A section's heading, its Clear link and its data caveat (spec 002 AC9).
export function SectionHead({
  title,
  clearHref,
  note,
  noteHref,
}: {
  title: string;
  clearHref?: string | null;
  note?: string;
  // The caveat's explanation on the About page.
  noteHref?: string;
}) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-bold">{title}</h3>
        {clearHref && (
          <Link href={clearHref} className={`${ui.link} min-h-6 py-0 text-[13px]`} {...filterLink}>
            Clear
          </Link>
        )}
      </div>
      {note && (
        <p className="mt-1 mb-1.5 text-[12.5px] leading-[1.4] text-ink-600">
          {note}
          {noteHref && (
            <>
              {' '}
              <Link href={noteHref} prefetch={false}>
                Read more
              </Link>
            </>
          )}
        </p>
      )}
    </>
  );
}

// "Records with [any] [all] of these", for list fields with two or more values selected.
export function MatchSwitch({ query, facet }: { query: Query; facet: FilterKey }) {
  const current = query.filters[facet].match;
  const segment = (match: 'any' | 'all', side: string) => (
    <Link
      href={queryHref(setMatch(query, facet, match))}
      aria-current={current === match ? 'true' : undefined}
      className={`inline-flex min-h-8 items-center border px-3 text-[13px] font-semibold no-underline ${side} ${
        current === match ? 'border-ink-950 bg-ink-950 text-white hover:text-white' : 'border-ink-300 bg-white text-ink-950 hover:text-ink-950'
      }`}
      {...filterLink}
    >
      {match}
    </Link>
  );
  return (
    <div role="group" aria-label="How these values combine" className="my-1.5 flex items-center gap-2 text-[13px] text-ink-700">
      Records with
      <div className="flex">
        {segment('any', 'rounded-l-md')}
        {segment('all', 'rounded-r-md border-l-0')}
      </div>
      of these
    </div>
  );
}

// A filter with a value list, as in the prototype: the top values, the rest
// one click away, a find box for long lists, and selected values always shown (AC6).
export function FacetSection({
  query,
  facet,
  title,
  note,
  noteHref,
  values,
  show,
  listField,
  findPlaceholder,
  isDefault = false,
  topOnly = false,
  remote,
}: {
  query: Query;
  facet: FilterKey;
  title: string;
  note?: string;
  noteHref?: string;
  // Sorted the way they should be shown, with selected values included even at 0.
  values: FacetValue[];
  show: number;
  listField: boolean;
  findPlaceholder: string;
  // The default selection, such as retractions only, has no Clear link.
  isDefault?: boolean;
  // Only the top values are known, as for journals and publishers.
  topOnly?: boolean;
  // Typed text finds values through the site's route handler instead of in the page.
  remote?: 'journal' | 'publisher';
}) {
  const [more, setMore] = useState(false);
  const [find, setFind] = useState('');
  const selection = query.filters[facet];
  const selected = new Set([...selection.include, ...selection.exclude]);
  const needle = find.trim().toLowerCase();
  const remoteResult = useRemoteValues(remote, find, query);
  const remoteText = remote && find.trim().length >= 2;

  const matching = !needle
    ? values
    : remoteText
      ? remoteResult && 'values' in remoteResult
        ? remoteResult.values
        : []
      : values.filter((entry) => entry.label.toLowerCase().includes(needle));
  const limit = more || needle ? MORE_LIMIT : show;
  const shown = matching.slice(0, limit);
  // A selected value stays visible even when it's past the limit or its count is 0.
  if (!needle) {
    for (const entry of values) {
      if (selected.has(entry.value) && !shown.includes(entry)) {
        shown.push(entry);
      }
    }
  }
  const hasSelection = selected.size > 0 && !isDefault;

  return (
    <section className="border-t border-[#e3e6ea] py-3.5">
      <SectionHead title={title} clearHref={hasSelection ? queryHref(clearFilter(query, facet)) : null} note={note} noteHref={noteHref} />
      {(remote || values.length > 12) && (
        <input
          type="search"
          value={find}
          onChange={(event) => setFind(event.target.value)}
          aria-label={`Search ${title.toLowerCase()} values`}
          placeholder={findPlaceholder}
          className={`${ui.input} my-1.5 min-h-[34px] text-sm`}
        />
      )}
      {listField && selection.include.length > 1 && <MatchSwitch query={query} facet={facet} />}
      <ul className="mt-1 flex list-none flex-col gap-px">
        {shown.map((entry) => (
          <li key={entry.value}>
            <ValueRow query={query} facet={facet} value={entry.value} label={entry.label} count={entry.count} after={entry.after} />
          </li>
        ))}
      </ul>
      {shown.length === 0 && (
        <p role="status" className="mt-1.5 text-[13px] text-ink-600">
          {!needle
            ? 'No values for these results.'
            : remoteText && !remoteResult
              ? 'Searching…'
              : remoteResult && 'error' in remoteResult
                ? remoteResult.error === 'limited'
                  ? `Too many searches in a short time. Try again in ${formatWait(remoteResult.retryAfter)}.`
                  : 'Search is unavailable right now.'
                : `No ${title.toLowerCase()} values match “${find.trim()}”.`}
        </p>
      )}
      {remoteText && remoteResult && 'values' in remoteResult && remoteResult.values.length >= MORE_LIMIT && (
        <p className="mt-1.5 text-[12.5px] text-ink-600">Showing the top {MORE_LIMIT} matches. Type more to narrow them.</p>
      )}
      {!remoteText && matching.length > limit && (more || needle) && (
        <p className="mt-1.5 text-[12.5px] text-ink-600">
          {topOnly
            ? `Showing the top ${limit}. Type to find the rest.`
            : `Showing the top ${limit} of ${formatNumber(matching.length)}. Type to find the rest.`}
        </p>
      )}
      {!needle && values.length > show && (
        <button type="button" onClick={() => setMore(!more)} className={`${ui.link} text-[13px]`}>
          {more ? 'Show fewer' : topOnly ? `Show the top ${Math.min(values.length, MORE_LIMIT)}` : `Show all ${formatNumber(values.length)}`}
        </button>
      )}
    </section>
  );
}
