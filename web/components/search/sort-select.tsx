'use client';

// The sort menu. A client component, because choosing an order needs a
// browser event; it navigates to the URL the server worked out for each order.
import { useSearchNavigation } from '@/components/filters/pending';
import { SelectMenu } from '@/components/select-menu';
import type { Sort } from '@/lib/query/types';

const LABELS: Record<Sort, string> = {
  relevance: 'Relevance (with search text)',
  newest: 'Newest notice first',
  oldest: 'Oldest notice first',
  paper_newest: 'Newest paper first',
  paper_oldest: 'Oldest paper first',
};

export function SortSelect({ value, hrefs, hasText }: { value: Sort; hrefs: Record<Sort, string>; hasText: boolean }) {
  const navigate = useSearchNavigation();
  return (
    <>
      <label htmlFor="sort" className="text-sm text-ink-700">
        Sort
      </label>
      <SelectMenu
        id="sort"
        value={value}
        onValueChange={(sort) => navigate(hrefs[sort as Sort])}
        options={(Object.keys(LABELS) as Sort[]).map((sort) => ({
          value: sort,
          label: LABELS[sort],
          disabled: sort === 'relevance' && !hasText,
        }))}
        className="min-h-[38px] min-w-[236px]"
      />
    </>
  );
}
