import { ui } from '@/components/ui';
import { formatWait } from '@/lib/rate-limit';

// Shown instead of results when a visitor is over the search limit (spec 002
// AC28), as in the prototype's "Search limit reached" state. The query stays in
// the address bar and the search box, and is described here.
export function SearchLimitReached({ retryAfter, sentence, retryHref }: { retryAfter: number; sentence: string; retryHref: string }) {
  return (
    <div className="flex max-w-[720px] flex-col gap-3.5 py-8">
      <div role="alert" className="rounded-lg border border-[#e2bc72] bg-[#fff4e0] px-4 py-3.5 text-[#4a3300]">
        <h1 className="font-bold">Too many searches in a short time</h1>
        <p className="mt-1 text-sm">You can search again in {formatWait(retryAfter)}. Your search is kept, so nothing needs retyping.</p>
      </div>
      <p className="text-sm text-ink-700">{sentence}</p>
      <div className="flex gap-2.5">
        <a href={retryHref} className={ui.btn}>
          Try again
        </a>
      </div>
    </div>
  );
}
