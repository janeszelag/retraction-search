'use client';

// Remembers the page before this one, for "Back to results" on record pages.
// Moving between pages inside the site doesn't change document.referrer, so
// the site keeps track itself.
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

let current: string | null = null;
let previous: string | null = null;

export function NavigationMemory() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname !== current) {
      previous = current;
      current = pathname;
    }
  }, [pathname]);
  return null;
}

// True when the visitor came to this page from the search page on this site.
export function cameFromSearch(): boolean {
  if (previous !== null) {
    return previous === '/';
  }
  // After a full page load, the browser's referrer says where the visitor came from.
  try {
    const referrer = new URL(document.referrer);
    return referrer.origin === window.location.origin && referrer.pathname === '/';
  } catch {
    return false;
  }
}
