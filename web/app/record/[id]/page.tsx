import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { PageHeader } from '@/components/page-header';
import { BackToResults } from '@/components/record/back-to-results';
import { CopyLink } from '@/components/record/copy-link';
import { Unavailable } from '@/components/search/unavailable';
import { ui } from '@/components/ui';
import { formatApDate } from '@/lib/format/dates';
import { describeLink } from '@/lib/format/links';
import { noticeTypeClasses } from '@/lib/format/notice-types';
import { publishedRows } from '@/lib/format/published';
import { reasonGroup } from '@/lib/format/reasons';
import { addAuthorName, onlyValue } from '@/lib/query/changes';
import { subjectLabel } from '@/lib/query/subjects';
import { defaultQuery } from '@/lib/query/types';
import { queryHref } from '@/lib/query/url';
import { getMeta, getRecord } from '@/lib/server/search';

// The record page (spec 002 AC22). A server component: the record is read from
// Typesense on the server, and its URL is always just /record/<id>, so a link
// to a record never carries a search.

const PAYWALL_LABELS: Record<string, string> = { No: 'Not paywalled', Yes: 'Paywalled', Unknown: 'Unknown' };

// The page and its metadata both need the record; cache shares one read per request.
const loadRecord = cache((id: number) => getRecord(id));

type Props = { params: Promise<{ id: string }> };

// Record IDs are positive whole numbers.
const RECORD_ID = /^[1-9]\d{0,9}$/;

async function recordId(params: Props['params']): Promise<number> {
  const { id } = await params;
  if (!RECORD_ID.test(id)) {
    notFound();
  }
  return Number(id);
}

// The not-found file can't set the title, so a missing record's comes from here.
// This doesn't call notFound(): the page does.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const result = RECORD_ID.test(id) ? await loadRecord(Number(id)) : { status: 'not-found' as const };
  if (result.status === 'ok') {
    return { title: `${result.record.title} · Retraction search` };
  }
  return { title: result.status === 'not-found' ? 'No record with this ID · Retraction search' : 'Retraction search' };
}

const sectionTitle = 'text-lg font-[750]';
const sectionNote = 'text-[13.5px] text-ink-600';
const term = 'text-[12.5px] text-ink-600';
const nameLink = 'text-inherit decoration-[#c3cad3] underline-offset-[3px] hover:text-accent hover:decoration-accent';

export default async function RecordPage({ params }: Props) {
  const id = await recordId(params);
  const [result, meta] = await Promise.all([loadRecord(id), getMeta()]);
  if (result.status === 'not-found') {
    notFound();
  }

  return (
    <>
      {/* No search box here, as in the design (AC22). */}
      <PageHeader dataDate={meta?.dataDate ?? null} />
      {result.status === 'unavailable' ? (
        <main className={`${ui.wrap} pt-6 pb-12`}>
          <Unavailable retryHref={`/record/${id}`} />
        </main>
      ) : (
        <RecordBody record={result.record} />
      )}
    </>
  );
}

function RecordBody({ record }: { record: Extract<Awaited<ReturnType<typeof getRecord>>, { status: 'ok' }>['record'] }) {
  const base = defaultQuery();
  const links = record.urls.map((url, index) => describeLink(url, record.urlRecordCounts[index]));
  const rows = publishedRows(record);
  const dayOne = (seconds: number) => new Date(seconds * 1000).getUTCDate() === 1;

  return (
    <main className={`${ui.wrap} flex flex-col gap-7 pt-6 pb-12`}>
      <BackToResults />
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-sm text-ink-700">
          <span className={`${ui.tag} px-2.5 py-[3px] text-[13px] ${noticeTypeClasses(record.noticeType)}`}>{record.noticeType}</span>
          <span>Notice issued {formatApDate(record.noticeDate)}</span>
          <span aria-hidden="true">·</span>
          <span>Paper published {formatApDate(record.paperDate)}</span>
          <span aria-hidden="true">·</span>
          <span>
            Record <span className="font-mono">{record.recordId}</span>
          </span>
          {record.isRevision && <span className={`${ui.tag} border-ink-300 bg-white text-ink-700`}>Revised version</span>}
        </div>
        <h1 className="max-w-[900px] text-[28px] leading-tight font-[750] tracking-[-0.01em]">{record.title}</h1>
        <p className="text-base text-ink-800">
          {record.journal && (
            <Link href={queryHref(onlyValue(base, 'journal', record.journal))} title="Show only this journal" className={`italic ${nameLink}`} prefetch={false}>
              {record.journal}
            </Link>
          )}
          <span aria-hidden="true" className="px-1.5">
            ·
          </span>
          {record.publisher && (
            <Link href={queryHref(onlyValue(base, 'publisher', record.publisher))} title="Show only this publisher" className={nameLink} prefetch={false}>
              {record.publisher}
            </Link>
          )}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
          {record.noticeDoi && (
            <a href={`https://doi.org/${record.noticeDoi}`} target="_blank" rel="noopener" className={ui.btnPrimary}>
              Read the notice
            </a>
          )}
          {record.paperDoi && (
            <a href={`https://doi.org/${record.paperDoi}`} target="_blank" rel="noopener" className={ui.btn}>
              Original paper
            </a>
          )}
          <CopyLink path={`/record/${record.recordId}`} />
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className={sectionTitle}>Reasons</h2>
        <p className={sectionNote}>
          Retraction Watch’s classification of this notice, which it updates as new information arrives. Colors group reasons by topic; the grouping is
          this site’s, not Retraction Watch’s.
        </p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {record.reasons.map((reason) => {
            const group = reasonGroup(reason);
            return (
              <span key={reason} title={`${group.name} (this site's grouping)`} className={`inline-block rounded border px-2.5 py-[3px] text-sm ${group.classes}`}>
                {reason}
              </span>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={sectionTitle}>Retraction Watch coverage</h2>
        {links.length > 0 ? (
          <>
            <p className={sectionNote}>
              Links Retraction Watch lists for this record. A post can cover many retractions at once; the count shows how many records link to it.
            </p>
            <ul className="mt-1 list-none rounded-lg border border-ink-150">
              {links.map((link, index) => (
                <li key={`${link.href}-${index}`} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-[#e3e6ea] px-4 py-3 last:border-b-0">
                  <span className="flex-none text-[13.5px] text-ink-700">{link.source}</span>
                  <a href={link.href} target="_blank" rel="noopener" className="flex-[999_1_320px] font-semibold break-words">
                    {link.text}
                  </a>
                  <span className="text-[12.5px] text-ink-600">{link.shared ?? 'Only this record'}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-ink-700">Retraction Watch lists no links for this record.</p>
        )}
      </section>

      <section className="flex flex-col gap-2.5">
        <h2 className={sectionTitle}>Details</h2>
        <dl className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-8 gap-y-3.5 rounded-lg border border-ink-150 p-[18px]">
          <div>
            <dt className={term}>Notice date</dt>
            <dd>{formatApDate(record.noticeDate)}</dd>
          </div>
          <div>
            <dt className={term}>Paper date</dt>
            <dd>{formatApDate(record.paperDate)}</dd>
          </div>
          <div>
            <dt className={term}>Notice DOI</dt>
            <dd className="font-mono break-all">
              {record.noticeDoi ? (
                <a href={`https://doi.org/${record.noticeDoi}`} target="_blank" rel="noopener">
                  {record.noticeDoi}
                </a>
              ) : (
                'None'
              )}
            </dd>
          </div>
          <div>
            <dt className={term}>Paper DOI</dt>
            <dd className="font-mono break-all">
              {record.paperDoi ? (
                <a href={`https://doi.org/${record.paperDoi}`} target="_blank" rel="noopener">
                  {record.paperDoi}
                </a>
              ) : (
                'None'
              )}
            </dd>
          </div>
          <div>
            <dt className={term}>PubMed IDs (notice, paper)</dt>
            <dd className="font-mono">
              {record.noticePubmedId ?? 'None'}, {record.paperPubmedId ?? 'None'}
            </dd>
          </div>
          <div>
            <dt className={term}>Article type</dt>
            <dd>{record.articleTypes.join('; ') || 'None listed'}</dd>
          </div>
          <div>
            <dt className={term}>Notice paywalled</dt>
            <dd>
              {PAYWALL_LABELS[record.paywalled] ?? 'Not recorded'} <span className="text-[12.5px] text-ink-600">(describes the notice, not the paper)</span>
            </dd>
          </div>
          <div>
            <dt className={term}>Subjects</dt>
            <dd>{record.subjects.map(subjectLabel).join('; ') || 'None listed'}</dd>
          </div>
          <div>
            <dt className={term}>Countries</dt>
            <dd>
              {record.countries.join('; ') || 'None listed'} <span className="block text-[12.5px] text-ink-600">The countries of all authors’ affiliations</span>
            </dd>
          </div>
        </dl>
        {(dayOne(record.noticeDate) || dayOne(record.paperDate)) && (
          <p className="text-[13px] text-ink-600">
            Retraction Watch records an unknown day as the 1st of the month, so a date on the 1st may only be accurate to the month.
          </p>
        )}
      </section>

      <section className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-7">
        <div className="flex flex-col gap-2">
          <h2 className={sectionTitle}>Author names ({record.authors.length})</h2>
          {/* The design said "list it exactly"; AC14 now ignores capitals, accents and punctuation. */}
          <p className={sectionNote}>
            As Retraction Watch recorded them, in order. Names are not linked to identities: one name can belong to several people. Select a name to see
            other records that list it, ignoring capitals, accents and punctuation.
          </p>
          <ol className="mt-1 flex list-decimal flex-col gap-0.5 pl-[26px]">
            {record.authors.map((name, index) => (
              <li key={`${name}-${index}`}>
                <Link
                  href={queryHref(addAuthorName(base, name))}
                  title="Show records that list this name"
                  aria-label={`Show records that list the name ${name}`}
                  className={nameLink}
                  prefetch={false}
                >
                  {name}
                </Link>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex flex-col gap-2">
          <h2 className={sectionTitle}>Institutions</h2>
          <p className={sectionNote}>Free text, as Retraction Watch recorded it.</p>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm">
            {record.institutions.map((institution, index) => (
              <li key={`${institution}-${index}`}>{institution}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={sectionTitle}>Retraction Watch’s notes</h2>
        {record.notes ? (
          <p className="rounded-md bg-ink-25 px-3.5 py-3 text-sm break-words whitespace-pre-line">{record.notes}</p>
        ) : (
          <p className="text-sm text-ink-700">Retraction Watch recorded no notes for this record.</p>
        )}
      </section>

      {rows.length > 0 && (
        <details className="rounded-lg border border-ink-150 px-4 py-3.5">
          <summary className="cursor-pointer font-[650]">As Retraction Watch published it</summary>
          <p className="my-2.5 text-[13.5px] text-ink-600">
            This site cleans some fields so they can be filtered. These are the original values for the fields that cleaning changed in this record.
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-[520px] text-left text-sm">
              <thead>
                <tr className="text-[12.5px] text-ink-600">
                  <th className="pr-5 pb-2 font-bold">Field</th>
                  <th className="pr-5 pb-2 font-bold">Published value</th>
                  <th className="pb-2 font-bold">Shown here as</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.field} className="align-top">
                    <td className="pr-5 pb-2">{row.field}</td>
                    <td className="pr-5 pb-2 font-mono break-all">{row.published}</td>
                    <td className="pb-2 break-words">{row.shown}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </main>
  );
}
