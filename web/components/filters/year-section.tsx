'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ui } from '@/components/ui';
import { formatNumber } from '@/lib/format/numbers';
import { setYears } from '@/lib/query/changes';
import type { Query, YearRange } from '@/lib/query/types';
import { queryHref } from '@/lib/query/url';
import type { ValueCount } from '@/lib/search/types';
import { SectionHead } from './facet-section';
import { ReportPending } from './pending';
import { filterLink } from './value-row';

// Bars start here; earlier years share one bar (as in the prototype).
const FIRST_BAR_YEAR = 2000;
const BAR_HEIGHT = 48;
// Typed years update the URL after this pause, so each keystroke isn't a search.
const TYPING_PAUSE_MS = 300;

const yearText = (year: number | null) => (year === null ? '' : String(year));

// A year filter: a bar per year, which selects that year, and "from" and "to"
// inputs. The counts ignore this filter's own range (spec 002 AC4, AC8).
export function YearSection({
  query,
  which,
  title,
  note,
  noteHref,
  counts,
  lastYear,
}: {
  query: Query;
  which: 'noticeYears' | 'paperYears';
  title: string;
  note: string;
  noteHref: string;
  counts: ValueCount[];
  lastYear: number;
}) {
  const router = useRouter();
  const range = query[which];
  const [from, setFrom] = useState(yearText(range.from));
  const [to, setTo] = useState(yearText(range.to));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A new page from the server (such as after Clear) resets the inputs.
  useEffect(() => {
    setFrom(yearText(range.from));
    setTo(yearText(range.to));
  }, [range.from, range.to]);
  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
  }, []);

  const typed = (nextFrom: string, nextTo: string) => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    const parse = (text: string) => (/^\d{4}$/.test(text.trim()) ? Number(text.trim()) : text.trim() === '' ? null : undefined);
    const [a, b] = [parse(nextFrom), parse(nextTo)];
    // Wait until each box is empty or holds a full year.
    if (a === undefined || b === undefined) {
      return;
    }
    timer.current = setTimeout(() => router.push(queryHref(setYears(query, which, { from: a, to: b })), { scroll: false }), TYPING_PAUSE_MS);
  };

  const byYear = new Map(counts.map((entry) => [Number(entry.value), entry.count]));
  const earlier = counts.reduce((sum, entry) => (Number(entry.value) < FIRST_BAR_YEAR ? sum + entry.count : sum), 0);
  const bars: { label: string; tick: string; count: number; pick: YearRange; inRange: boolean }[] = [
    {
      label: `Before ${FIRST_BAR_YEAR}`,
      tick: 'Earlier',
      count: earlier,
      pick: { from: null, to: FIRST_BAR_YEAR - 1 },
      inRange: range.from === null || range.from < FIRST_BAR_YEAR,
    },
  ];
  for (let year = FIRST_BAR_YEAR; year <= lastYear; year += 1) {
    bars.push({
      label: String(year),
      tick: year % 5 === 0 && year - FIRST_BAR_YEAR >= 4 ? String(year) : '',
      count: byYear.get(year) ?? 0,
      pick: { from: year, to: year },
      inRange: (range.from === null || year >= range.from) && (range.to === null || year <= range.to),
    });
  }
  const max = Math.max(1, ...bars.map((bar) => bar.count));
  const ranged = range.from !== null || range.to !== null;
  const hasRange = ranged ? queryHref(setYears(query, which, { from: null, to: null })) : null;

  return (
    <section className="border-t border-[#e3e6ea] py-3.5">
      <SectionHead title={title} clearHref={hasRange} note={note} noteHref={noteHref} />
      <div role="group" aria-label={`Records per ${title.toLowerCase()}. Select a bar to choose that year.`} className="mt-2 flex h-12 items-end gap-0.5">
        {bars.map((bar) => (
          <Link
            key={bar.label}
            href={queryHref(setYears(query, which, bar.pick))}
            title={`${bar.label}: ${formatNumber(bar.count)}`}
            aria-label={`${bar.label}: ${formatNumber(bar.count)} records. Select this year.`}
            className="group flex h-full min-w-0 flex-1 flex-col justify-end"
            {...filterLink}
          >
            <span
              className={`block rounded-t-[2px] group-hover:brightness-[.82] ${!ranged ? 'bg-[#7d93b2]' : bar.inRange ? 'bg-accent' : 'bg-[#d3d9e1]'}`}
              style={{ height: bar.count ? Math.max(2, Math.round((bar.count / max) * BAR_HEIGHT)) : 0 }}
            />
            <ReportPending />
          </Link>
        ))}
      </div>
      <div aria-hidden="true" className="mt-[3px] flex h-3.5 gap-0.5">
        {bars.map((bar) => (
          <span key={bar.label} className="min-w-0 flex-1 overflow-visible text-[10.5px] whitespace-nowrap text-ink-600">
            {bar.tick}
          </span>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 text-sm">
        <span>From</span>
        <input
          inputMode="numeric"
          aria-label={`${title} from`}
          placeholder="Any"
          value={from}
          onChange={(event) => {
            setFrom(event.target.value);
            typed(event.target.value, to);
          }}
          className={`${ui.input} min-h-9 w-[76px]`}
        />
        <span>to</span>
        <input
          inputMode="numeric"
          aria-label={`${title} to`}
          placeholder="Any"
          value={to}
          onChange={(event) => {
            setTo(event.target.value);
            typed(from, event.target.value);
          }}
          className={`${ui.input} min-h-9 w-[76px]`}
        />
      </div>
    </section>
  );
}
