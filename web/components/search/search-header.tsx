import Link from 'next/link';
import { AboutRetractionsLink, HeaderSource } from '@/components/header-links';
import { ui } from '@/components/ui';
import type { Query } from '@/lib/query/types';
import { SearchControls } from './search-controls';

// The header of the search page (plan 002, "Layout"): the site name, data
// source and About link above the filter column, the search box above the
// results.
export function SearchHeader({ query, dataDate }: { query: Query; dataDate: string | null }) {
  return (
    <header className="border-b border-ink-150">
      <div className={`${ui.wrap} ${ui.cols} items-start py-6`}>
        <div className={`${ui.sideCol} flex flex-col gap-2 pt-1`}>
          <Link href="/" className="text-xl leading-tight font-extrabold tracking-[-0.01em] text-ink-950 no-underline hover:text-ink-950">
            Retraction search
          </Link>
          <HeaderSource lead="Search the " dataDate={dataDate} />
          <AboutRetractionsLink className="self-start" />
        </div>
        <div className={ui.mainCol}>
          <SearchControls query={query} />
        </div>
      </div>
    </header>
  );
}
