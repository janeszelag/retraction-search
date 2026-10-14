'use client';

// Shown only to visitors who came from a search on this site, never to someone
// arriving from a shared link (spec 002 AC22). It goes back in the browser's
// history, so the results and the scroll position return as they were.
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChevronLeftIcon } from '@/components/icons';
import { cameFromSearch } from '@/components/navigation-memory';
import { ui } from '@/components/ui';

export function BackToResults() {
  const router = useRouter();
  const [show, setShow] = useState(false);
  useEffect(() => setShow(cameFromSearch()), []);
  if (!show) {
    return null;
  }
  return (
    <button type="button" onClick={() => router.back()} className={`${ui.link} gap-1.5 self-start`}>
      <ChevronLeftIcon />
      Back to results
    </button>
  );
}
