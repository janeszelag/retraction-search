import Link from 'next/link';
import { ui } from '@/components/ui';
import { formatDataDate } from '@/lib/format/dates';

// The header of pages without a search box (record pages and About, as in the
// design): the site's name, linking to the search, and the data date.
export function PageHeader({ dataDate }: { dataDate: string | null }) {
  return (
    <header className="border-b border-ink-150">
      <div className={`${ui.wrap} flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5 py-3.5`}>
        <Link href="/" className="text-xl font-extrabold tracking-[-0.01em] text-ink-950 no-underline hover:text-ink-950">
          Retraction search
        </Link>
        <span className="text-[13px] text-ink-600">Retraction Watch Database{dataDate ? ` · Data as of ${formatDataDate(dataDate)}` : ''}</span>
      </div>
    </header>
  );
}
