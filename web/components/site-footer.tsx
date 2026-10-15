import { Suspense } from 'react';
import { IssueLink } from '@/components/issue-link';
import { formatDataDate } from '@/lib/format/dates';
import { formatNumber } from '@/lib/format/numbers';
import { DATA_SOURCE, RW_USER_GUIDE, issueUrl } from '@/lib/links';

export interface Snapshot {
  dataDate: string;
  commit: string;
  documents: number;
}

const external = { target: '_blank', rel: 'noopener' } as const;

// The attribution on every page, as in the chosen design (spec 002 AC25).
export function SiteFooter({ snapshot, origin }: { snapshot: Snapshot | null; origin: string }) {
  const dataDate = snapshot ? formatDataDate(snapshot.dataDate) : undefined;
  return (
    <footer className="border-t border-ink-150 bg-ink-25">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-1.5 px-4 pt-5 pb-6 text-[13px] text-ink-750 min-[821px]:px-6">
        <p>
          Data from the{' '}
          <a href={RW_USER_GUIDE} {...external}>
            Retraction Watch Database
          </a>
          , released under CC0 and distributed by Crossref at{' '}
          <a href={DATA_SOURCE} {...external}>
            gitlab.com/crossref/retraction-watch-data
          </a>
          .
          {snapshot && (
            <>
              {' '}
              Snapshot of {formatDataDate(snapshot.dataDate)} (commit <span className="font-mono">{snapshot.commit}</span>),{' '}
              {formatNumber(snapshot.documents)} records.
            </>
          )}
        </p>
        <p>
          Not affiliated with Retraction Watch or Crossref. Reasons are Retraction Watch’s classification. Author names are
          matched as names, not identified people.
        </p>
        <p>
          <a href="/about">About this data</a> · Missing retraction?{' '}
          <a href={RW_USER_GUIDE} {...external}>
            Tell Retraction Watch
          </a>{' '}
          · Problem with this site?{' '}
          {/* Until the page's address is read, the link opens an issue without it. */}
          <Suspense
            fallback={
              <a href={issueUrl({ title: 'Problem with this site', dataDate })} {...external}>
                Open an issue on GitHub
              </a>
            }
          >
            <IssueLink origin={origin} dataDate={dataDate} />
          </Suspense>
        </p>
      </div>
    </footer>
  );
}
