'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatNumber } from '@/lib/format/numbers';
import { toggleExclude, toggleInclude, valueState } from '@/lib/query/changes';
import type { FilterKey, Query } from '@/lib/query/types';
import { queryHref } from '@/lib/query/url';
import { useFilterLinkPending } from './pending';

type State = 'none' | 'include' | 'exclude';

// Filter links keep the scroll position and don't prefetch, so scrolling past
// them doesn't start searches (decision record 003).
export const filterLink = { prefetch: false, scroll: false } as const;

function Box({ state }: { state: State }) {
  const classes =
    state === 'include' ? 'border-accent bg-accent' : state === 'exclude' ? 'border-exclude bg-exclude' : 'border-ink-500 bg-white';
  return (
    <span aria-hidden="true" className={`grid h-4 w-4 flex-none place-items-center rounded border-[1.5px] ${classes}`}>
      {state === 'include' && (
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M1.5 5.2l2.2 2.2 4.8-5" fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {state === 'exclude' && (
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M2 5h6" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}

// Inside the value's link: shows the state the click leads to while it loads.
function PendingBox({ state, next }: { state: State; next: State }) {
  const pending = useFilterLinkPending();
  return <Box state={pending ? next : state} />;
}

// The minus button's icon, faint until hover on devices with a mouse.
function MinusIcon() {
  const pending = useFilterLinkPending();
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className={pending ? 'opacity-40' : ''}>
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.2 8h5.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const STATE_TEXT: Record<State, string> = { none: '', include: ', selected', exclude: ', excluded' };

// One value of a filter: select it to include it, or use the minus button to
// exclude it (spec 002 AC5). Screen readers hear the value, its count and its state (AC32).
export function ValueRow({
  query,
  facet,
  value,
  label,
  count,
  before,
  after,
}: {
  query: Query;
  facet: FilterKey;
  value: string;
  label: string;
  count: number;
  // Shown before the box, such as a subject group's open button.
  before?: ReactNode;
  // Shown after the label, such as a reason's group color.
  after?: ReactNode;
}) {
  const state = valueState(query, facet, value);
  const rowClasses = state === 'include' ? 'font-[650]' : state === 'exclude' ? 'text-exclude-ink line-through' : '';
  return (
    <div className="group flex items-center gap-0.5 rounded-md hover:bg-ink-50">
      {before}
      <Link
        href={queryHref(toggleInclude(query, facet, value))}
        aria-label={`${label}, ${formatNumber(count)} records${STATE_TEXT[state]}`}
        className="flex min-h-9 min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-1 text-left text-ink-950 no-underline hover:text-ink-950"
        {...filterLink}
      >
        <PendingBox state={state} next={state === 'include' ? 'none' : 'include'} />
        {after}
        <span className={`min-w-0 flex-1 text-sm break-words ${rowClasses}`}>
          {label}
          <span className="sr-only">{STATE_TEXT[state]}</span>
        </span>
        <span className="text-[13px] whitespace-nowrap text-ink-600 tabular-nums">
          {formatNumber(count)}
          <span className="sr-only"> records</span>
        </span>
      </Link>
      <Link
        href={queryHref(toggleExclude(query, facet, value))}
        aria-label={`${state === 'exclude' ? 'Stop excluding' : 'Exclude'} ${label}`}
        title={state === 'exclude' ? 'Undo' : 'Exclude'}
        className={`grid h-8 w-8 flex-none place-items-center rounded hover:bg-ink-100 hover:text-ink-950 ${
          state === 'exclude' ? 'text-exclude' : 'text-[#5b6572] pointer-fine:opacity-45 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100'
        }`}
        {...filterLink}
      >
        <MinusIcon />
      </Link>
    </div>
  );
}

// A yes-or-no option, such as including revised versions.
export function OptionRow({ href, on, label, count }: { href: string; on: boolean; label: string; count: number | null }) {
  return (
    <div className="flex items-center gap-0.5 rounded-md hover:bg-ink-50">
      <Link
        href={href}
        aria-label={`${label}${count !== null ? `, ${formatNumber(count)} records` : ''}${on ? ', selected' : ''}`}
        className="flex min-h-9 min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-1 text-left text-ink-950 no-underline hover:text-ink-950"
        {...filterLink}
      >
        <PendingBox state={on ? 'include' : 'none'} next={on ? 'none' : 'include'} />
        <span className={`min-w-0 flex-1 text-sm break-words ${on ? 'font-[650]' : ''}`}>
          {label}
          <span className="sr-only">{on ? ', selected' : ''}</span>
        </span>
        {count !== null && (
          <span className="text-[13px] whitespace-nowrap text-ink-600 tabular-nums">
            {formatNumber(count)}
            <span className="sr-only"> records</span>
          </span>
        )}
      </Link>
    </div>
  );
}
