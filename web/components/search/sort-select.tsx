'use client';

// The sort menu. A client component, because changing a select needs a
// browser event; it navigates to the URL the server worked out for each order.
import { useRouter } from 'next/navigation';
import { ChevronDownIcon } from '@/components/icons';
import { ui } from '@/components/ui';
import type { Sort } from '@/lib/query/types';

const LABELS: Record<Sort, string> = {
  relevance: 'Relevance (with search text)',
  newest: 'Newest notice first',
  oldest: 'Oldest notice first',
  paper_newest: 'Newest paper first',
  paper_oldest: 'Oldest paper first',
};

export function SortSelect({ value, hrefs, hasText }: { value: Sort; hrefs: Record<Sort, string>; hasText: boolean }) {
  const router = useRouter();
  return (
    <>
      <label htmlFor="sort" className="text-sm text-ink-700">
        Sort
      </label>
      <span className="relative inline-flex flex-none items-center">
        <select
          id="sort"
          value={value}
          onChange={(event) => router.push(hrefs[event.target.value as Sort])}
          className={`${ui.input} min-h-[38px] w-auto cursor-pointer appearance-none pr-9`}
        >
          {(Object.keys(LABELS) as Sort[]).map((sort) => (
            <option key={sort} value={sort} disabled={sort === 'relevance' && !hasText}>
              {LABELS[sort]}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-3 text-ink-700">
          <ChevronDownIcon />
        </span>
      </span>
    </>
  );
}
