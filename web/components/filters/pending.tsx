'use client';

// While a filter link's navigation is pending, the clicked value shows its new
// state and the old results dim, until the server's new page arrives
// (decision record 003).
import { useLinkStatus } from 'next/link';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, useTransition, type ReactNode } from 'react';

const PendingContext = createContext<{ change: (delta: number) => void; pending: boolean }>({ change: () => {}, pending: false });

export function PendingProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);
  const change = useCallback((delta: number) => setCount((current) => Math.max(0, current + delta)), []);
  return <PendingContext.Provider value={{ change, pending: count > 0 }}>{children}</PendingContext.Provider>;
}

// For use inside a Link: is this link's navigation on its way? Tells the page too.
export function useFilterLinkPending(): boolean {
  const { pending } = useLinkStatus();
  const { change } = useContext(PendingContext);
  useEffect(() => {
    if (!pending) {
      return;
    }
    change(1);
    return () => change(-1);
  }, [pending, change]);
  return pending;
}

// Inside a Link that has nothing else to show while pending.
export function ReportPending() {
  useFilterLinkPending();
  return null;
}

export function DimWhilePending({ children }: { children: ReactNode }) {
  const { pending } = useContext(PendingContext);
  return (
    <div aria-busy={pending} className={`transition-opacity duration-150 ${pending ? 'opacity-50' : ''}`}>
      {children}
    </div>
  );
}

// For typed input: navigates to a new search, and dims the old results while
// the server works on it, as filter links do.
export function useSearchNavigation(): (href: string) => void {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { change } = useContext(PendingContext);
  useEffect(() => {
    if (!isPending) {
      return;
    }
    change(1);
    return () => change(-1);
  }, [isPending, change]);
  return useCallback((href: string) => startTransition(() => router.push(href, { scroll: false })), [router]);
}
