import Link from 'next/link';
import { ui } from '@/components/ui';
import { formatApDate } from '@/lib/format/dates';
import { describeLink } from '@/lib/format/links';
import { noticeTypeClasses } from '@/lib/format/notice-types';
import { reasonGroup } from '@/lib/format/reasons';
import { onlyValue } from '@/lib/query/changes';
import type { IdentifierLookup } from '@/lib/query/identifier';
import { subjectLabel } from '@/lib/query/subjects';
import type { Query } from '@/lib/query/types';
import { queryHref } from '@/lib/query/url';
import type { ResultRecord } from '@/lib/search/types';
import { AuthorList } from './author-list';
import { Highlighted } from './highlighted';
import { ResultFields } from './result-fields';

export { Highlighted };

const PAYWALL_LABELS: Record<string, string> = { No: 'Not paywalled', Yes: 'Paywalled', Unknown: 'Unknown' };

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

// Journal and publisher filter the search to themselves (spec 002 AC18b).
const filterLink = 'text-inherit decoration-[#c3cad3] underline-offset-[3px] hover:text-accent hover:decoration-accent';

export function ResultItem({ record, query, lookup }: { record: ResultRecord; query: Query; lookup: IdentifierLookup | null }) {
  const match = lookupMatch(record, lookup);
  const links = record.urls.map((url, index) => describeLink(url, record.urlRecordCounts[index]));
  const onlyJournal = query.filters.journal.include.length === 1 && query.filters.journal.include[0] === record.journal;
  const onlyPublisher = query.filters.publisher.include.length === 1 && query.filters.publisher.include[0] === record.publisher;
  const none = (list: string[]) => (list.length > 0 ? list.join('; ') : 'None listed');

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
        {record.journal && (
          <Link
            href={queryHref(onlyValue(query, 'journal', record.journal))}
            title="Show only this journal"
            aria-label={`Show only the journal ${record.journal}${onlyJournal ? ', selected' : ''}`}
            className={`italic ${filterLink} ${onlyJournal ? 'font-[650] text-accent decoration-accent' : ''}`}
            prefetch={false}
          >
            {record.journal}
          </Link>
        )}
        <span aria-hidden="true" className="px-1.5">
          ·
        </span>
        {record.publisher && (
          <Link
            href={queryHref(onlyValue(query, 'publisher', record.publisher))}
            title="Show only this publisher"
            aria-label={`Show only the publisher ${record.publisher}${onlyPublisher ? ', selected' : ''}`}
            className={`${filterLink} ${onlyPublisher ? 'font-[650] text-accent decoration-accent' : ''}`}
            prefetch={false}
          >
            {record.publisher}
          </Link>
        )}
      </p>
      {record.authors.length > 0 && (
        <AuthorList query={query} authors={record.authors} segments={record.authorSegments} matched={record.matchedAuthors} />
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
      {links.length > 0 && (
        <ul className="mt-2 flex list-none flex-col gap-[3px]">
          {links.map((link, index) => (
            <li key={`${link.href}-${index}`} className="text-sm leading-[1.4]">
              <span className="font-[650] text-ink-800">{link.source}: </span>
              <a href={link.href} target="_blank" rel="noopener">
                {link.text}
              </a>
              {link.shared && <span className="ml-2 text-[12.5px] whitespace-nowrap text-ink-600">{link.shared}</span>}
            </li>
          ))}
        </ul>
      )}
      <ResultFields
        recordId={record.recordId}
        noticeDoi={record.noticeDoi}
        paperDoi={record.paperDoi}
        fields={[
          { label: 'Record ID', value: String(record.recordId), mono: true },
          { label: 'Subjects', value: none(record.subjects.map(subjectLabel)) },
          { label: 'Article type', value: none(record.articleTypes) },
          { label: 'Notice paywalled', value: PAYWALL_LABELS[record.paywalled] ?? 'Not recorded' },
          { label: 'Notice DOI', value: record.noticeDoi ?? 'None', mono: true },
          { label: 'Paper DOI', value: record.paperDoi ?? 'None', mono: true },
          { label: 'Notice PubMed ID', value: record.noticePubmedId ? String(record.noticePubmedId) : 'None', mono: true },
          { label: 'Paper PubMed ID', value: record.paperPubmedId ? String(record.paperPubmedId) : 'None', mono: true },
        ]}
      />
    </li>
  );
}
