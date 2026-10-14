import Link from 'next/link';
import { ui } from '@/components/ui';
import { formatApDate } from '@/lib/format/dates';
import { noticeTypeClasses } from '@/lib/format/notice-types';
import { reasonGroup } from '@/lib/format/reasons';
import type { IdentifierLookup } from '@/lib/query/identifier';
import type { ResultRecord, Segment } from '@/lib/search/types';

// Matched words become <mark> elements; nothing is inserted as HTML.
export function Highlighted({ segments }: { segments: Segment[] }) {
  return segments.map((segment, index) => (segment.mark ? <mark key={index}>{segment.text}</mark> : <span key={index}>{segment.text}</span>));
}

// Which identifier a lookup matched, as the prototype words it (spec 002 AC12).
function lookupMatch(record: ResultRecord, lookup: IdentifierLookup | null): string | null {
  if (!lookup) {
    return null;
  }
  const [notice, paper, noun] =
    lookup.kind === 'doi'
      ? [record.noticeDoi === lookup.value, record.paperDoi === lookup.value, 'DOI']
      : [record.noticePubmedId === lookup.value, record.paperPubmedId === lookup.value, 'PubMed ID'];
  const which = notice && paper ? 'notice and paper' : notice ? 'notice' : paper ? 'paper' : null;
  return which ? `Matched the ${which} ${noun}` : null;
}

// The first ten author names, plus any further down that matched the search (spec 002 AC18).
const SHOWN_AUTHORS = 10;

export function ResultItem({ record, lookup }: { record: ResultRecord; lookup: IdentifierLookup | null }) {
  const match = lookupMatch(record, lookup);
  const later = record.matchedAuthors.filter((index) => index >= SHOWN_AUTHORS);
  const shown = [...record.authors.keys()].slice(0, SHOWN_AUTHORS);
  const listed = [...shown, ...later];
  return (
    <li className="border-b border-[#e3e6ea] pt-4 pb-[18px]">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-ink-600">
        <span className={`${ui.tag} ${noticeTypeClasses(record.noticeType)}`}>{record.noticeType}</span>
        <span>Notice issued {formatApDate(record.noticeDate)}</span>
        <span aria-hidden="true">·</span>
        <span>Paper published {formatApDate(record.paperDate)}</span>
        {record.isRevision && <span className={`${ui.tag} border-ink-300 bg-white text-ink-700`}>Revised version</span>}
        {match && <span className="font-[650] text-accent">{match}</span>}
      </div>
      <h2 className="mt-1.5 mb-1 text-[17px] leading-[1.35] font-[650]">
        <Link href={`/record/${record.recordId}`} className="text-ink-950 no-underline hover:text-accent hover:underline hover:underline-offset-[3px]">
          <Highlighted segments={record.titleSegments} />
        </Link>
      </h2>
      <p className="text-sm text-ink-800">
        {record.journal && <span className="italic">{record.journal}</span>}
        <span aria-hidden="true" className="px-1.5">
          ·
        </span>
        {record.publisher && <span>{record.publisher}</span>}
      </p>
      {record.authors.length > 0 && (
        <p className="mt-1 text-sm text-ink-800">
          <span className="text-ink-600">Author names: </span>
          {listed.map((index, position) => (
            <span key={index}>
              {position === shown.length && later.length > 0 && <span>… </span>}
              <Highlighted segments={record.authorSegments[index]} />
              {position < listed.length - 1 && ', '}
            </span>
          ))}
          {record.matchedAuthors.length > 0 && (
            <span
              className={`${ui.tag} ml-2 border-accent-line bg-accent-soft text-[#1b3f6e]`}
              title="The search matched a name. Names are not identities."
            >
              Name match
            </span>
          )}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span className="text-[13px] text-ink-600">Retraction Watch’s reasons:</span>
        {record.reasons.map((reason) => {
          const group = reasonGroup(reason);
          return (
            <span key={reason} title={`${group.name} (this site's grouping)`} className={`inline-block rounded border px-2 py-px text-[13px] ${group.classes}`}>
              {reason}
            </span>
          );
        })}
      </div>
      <p className="mt-1.5 text-[13px] text-ink-600">Countries: {record.countries.join(', ') || 'None listed'}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-[18px] text-sm">
        {record.noticeDoi && (
          <a href={`https://doi.org/${record.noticeDoi}`} target="_blank" rel="noopener">
            Notice
          </a>
        )}
        {record.paperDoi && (
          <a href={`https://doi.org/${record.paperDoi}`} target="_blank" rel="noopener">
            Paper
          </a>
        )}
        <Link href={`/record/${record.recordId}`} className={ui.link}>
          Record page
        </Link>
      </div>
    </li>
  );
}
