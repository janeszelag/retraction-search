import Form from 'next/form';
import Link from 'next/link';
import { ui } from '@/components/ui';
import { formatDataDate } from '@/lib/format/dates';
import type { Query } from '@/lib/query/types';
import { serializeQuery } from '@/lib/query/url';

// The header of the search page (plan 002, "Layout"): the site name and data
// date above the filter column, the search box above the results.
export function SearchHeader({ query, dataDate }: { query: Query; dataDate: string | null }) {
  // A new search keeps the filters but starts again on the first page.
  const kept = [...new URLSearchParams(serializeQuery({ ...query, q: '', page: 1 }))];
  return (
    <header className="border-b border-ink-150">
      <div className={`${ui.wrap} ${ui.cols} items-start py-4`}>
        <div className={`${ui.sideCol} flex flex-col gap-0.5 pt-0.5`}>
          <Link href="/" className="text-xl leading-tight font-extrabold tracking-[-0.01em] text-ink-950 no-underline hover:text-ink-950">
            Retraction search
          </Link>
          <span className="text-[13px] text-ink-600">
            Search the Retraction Watch Database{dataDate ? ` · Data as of ${formatDataDate(dataDate)}` : ''}
          </span>
        </div>
        <div className={`${ui.mainCol} flex flex-col gap-1.5`}>
          {/* next/form turns the submission into a client-side navigation, and still works without JavaScript. */}
          <Form action="/" role="search">
            <label htmlFor="q" className="sr-only">
              Search
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={query.q}
              placeholder="Search titles, author names, journals and publishers, or paste a DOI or PubMed ID"
              className={`${ui.input} min-h-11`}
            />
            {kept.map(([name, value], index) => (
              <input key={`${name}-${index}`} type="hidden" name={name} value={value} />
            ))}
          </Form>
        </div>
      </div>
    </header>
  );
}
