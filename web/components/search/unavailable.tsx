import { ui } from '@/components/ui';
import { DATA_SOURCE } from '@/lib/links';

// Shown instead of results when Typesense can't be reached (spec 002 AC29),
// as in the prototype's "Search unavailable" state.
export function Unavailable({ retryHref }: { retryHref: string }) {
  return (
    <div className="flex max-w-[720px] flex-col gap-3 py-8">
      <h1 className="text-2xl font-extrabold">Search is unavailable right now</h1>
      <p className="text-ink-800">
        The search server isn’t responding, so results and counts can’t be shown. Your search is kept in the address bar. Try again in a few minutes.
      </p>
      <p className="text-ink-800">
        The full dataset is always available from Crossref at{' '}
        <a href={DATA_SOURCE} target="_blank" rel="noopener">
          gitlab.com/crossref/retraction-watch-data
        </a>
        .
      </p>
      <div className="mt-1 flex gap-2.5">
        <a href={retryHref} className={ui.btnPrimary}>
          Try again
        </a>
      </div>
    </div>
  );
}
