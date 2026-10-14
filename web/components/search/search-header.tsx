import Link from 'next/link';
import { ui } from '@/components/ui';
import { formatDataDate } from '@/lib/format/dates';
import type { Query } from '@/lib/query/types';
import { SearchControls } from './search-controls';

// The header of the search page (plan 002, "Layout"): the site name and data
// date above the filter column, the search box above the results.
export function SearchHeader({ query, dataDate }: { query: Query; dataDate: string | null }) {
  return (
    <header className="border-b border-ink-150">
      <div className={`${ui.wrap} ${ui.cols} items-start py-6`}>
        <div className={`${ui.sideCol} flex flex-col gap-0.5 pt-1`}>
          <Link href="/" className="text-xl leading-tight font-extrabold tracking-[-0.01em] text-ink-950 no-underline hover:text-ink-950">
            Retraction search
          </Link>
          <span className="text-[13px] text-ink-600">
            Search the Retraction Watch Database{dataDate ? ` · Data as of ${formatDataDate(dataDate)}` : ''}
          </span>
        </div>
        <div className={ui.mainCol}>
          <SearchControls query={query} />
        </div>
      </div>
    </header>
  );
}
