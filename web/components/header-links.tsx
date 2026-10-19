import Link from 'next/link';
import { ui } from '@/components/ui';
import { formatDataDate } from '@/lib/format/dates';
import { CROSSREF_RW_DATA, RW_BLOG } from '@/lib/links';

const external = { target: '_blank', rel: 'noopener' } as const;

// The line under the site's name (plan 002, "Layout"): the database's name
// links to Retraction Watch's blog, and the data date to Crossref's page on the
// data. The date stays on one line when the line wraps.
export function HeaderSource({ lead = '', dataDate }: { lead?: string; dataDate: string | null }) {
  return (
    <span className="text-[15px] text-ink-600">
      {lead}
      <a href={RW_BLOG} {...external}>
        Retraction Watch Database
      </a>
      {dataDate && (
        <>
          {' · '}
          <a href={CROSSREF_RW_DATA} {...external} className="whitespace-nowrap">
            Data as of {formatDataDate(dataDate)}
          </a>
        </>
      )}
    </span>
  );
}

// The header's way into the About page. Not prefetched, since the firewall
// rule counts every request (plan 004, "Limits").
export function AboutRetractionsLink({ className = '' }: { className?: string }) {
  return (
    <Link href="/about#notice-types" prefetch={false} className={`${ui.link} ${className}`}>
      What is a retraction?
    </Link>
  );
}
