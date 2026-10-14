'use client';

// Shown only to visitors who came from a search on this site, never to someone
// arriving from a shared link (spec 002 AC22). It goes back in the browser's
// history, so the results and the scroll position return as they were.
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
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
    <button type="button" onClick={() => router.back()} className={`${ui.link} self-start`}>
      Back to results
    </button>
  );
}
