'use client';

// "Open an issue on GitHub" in the footer, filled in with the page's link and
// the data date (spec 002 AC25). The footer sits in the layout, which doesn't
// see the page's address on the server, so this small client component reads
// it, and follows the page as filters change it.
import { usePathname, useSearchParams } from 'next/navigation';
import { pageIssueUrl } from '@/lib/links';

export function IssueLink({ origin, dataDate }: { origin: string; dataDate?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <a href={pageIssueUrl({ origin, pathname, search: searchParams.toString(), dataDate })} target="_blank" rel="noopener">
      Open an issue on GitHub
    </a>
  );
}
