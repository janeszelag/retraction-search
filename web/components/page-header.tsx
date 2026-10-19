import Link from 'next/link';
import { AboutRetractionsLink, HeaderSource } from '@/components/header-links';
import { ui } from '@/components/ui';

// The header of pages without a search box (record pages and About, as in the
// design): the site's name, linking to the search, then the data source and
// the About link.
export function PageHeader({ dataDate }: { dataDate: string | null }) {
  return (
    <header className="border-b border-ink-150">
      <div className={`${ui.wrap} flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 py-3.5`}>
        <Link href="/" className="text-xl font-extrabold tracking-[-0.01em] text-ink-950 no-underline hover:text-ink-950">
          Retraction search
        </Link>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <HeaderSource dataDate={dataDate} />
          <AboutRetractionsLink />
        </div>
      </div>
    </header>
  );
}
