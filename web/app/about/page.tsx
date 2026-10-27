import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/page-header';
import { ui } from '@/components/ui';
import { formatDataDate } from '@/lib/format/dates';
import { formatNumber } from '@/lib/format/numbers';
import { CROSSREF_LICENSES, DATA_ISSUES, DATA_SOURCE, REPOSITORY, RW_METHODOLOGY, RW_USER_GUIDE, issueUrl } from '@/lib/links';
import { indexedMetadata } from '@/lib/server/indexing';
import { getMeta } from '@/lib/server/search';

// The About page (spec 002 AC26): where the data comes from, its license,
// each data caveat in the product brief, how counts work, what the defaults
// hide, and how to report a missing retraction. The filters' "Read more"
// links point at the section ids here.

// One of the two pages search engines may index once SITE_INDEXING is on (spec 004 AC15).
export const metadata: Metadata = { title: 'About this data · Retraction search', ...indexedMetadata() };

const external = { target: '_blank', rel: 'noopener' } as const;

const SECTIONS = [
  ['source', 'Where the data comes from'],
  ['defaults', 'What the default view hides'],
  ['counts', 'How counts work'],
  ['notice-types', 'Notice types'],
  ['reasons', 'Reasons'],
  ['countries', 'Countries'],
  ['revisions', 'Revised versions'],
  ['editorial-staff', 'Editorial-staff notices'],
  ['dates', 'Dates'],
  ['paywalled', 'Paywalled'],
  ['coverage', 'Coverage'],
  ['author-names', 'Author names'],
  ['missing', 'Reporting a missing retraction'],
  ['site-problems', 'Problems with this site'],
] as const;

type SectionId = (typeof SECTIONS)[number][0];

function Section({ id, children }: { id: SectionId; children: ReactNode }) {
  const title = SECTIONS.find(([key]) => key === id)?.[1];
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-4 flex-col gap-3">
      <h2 id={`${id}-title`} className="text-lg font-[750]">
        {title}
      </h2>
      {children}
    </section>
  );
}

const list = 'flex list-disc flex-col gap-2 pl-5';

export default async function AboutPage() {
  const meta = await getMeta();
  return (
    <>
      <PageHeader dataDate={meta?.dataDate ?? null} />
      <main className={`${ui.wrap} pt-8 pb-14`}>
        <article className="flex max-w-[720px] flex-col gap-9 text-[15px] leading-relaxed text-ink-900">
          <div className="flex flex-col gap-3">
            <h1 className="text-[28px] leading-tight font-[750] tracking-[-0.01em]">About this data</h1>
            <p>
              Retraction search is an independent search over the Retraction Watch Database. It isn’t affiliated with Retraction Watch or Crossref.
              This page explains where the data comes from, what it can and can’t tell you, and how this site counts.
            </p>
            <nav aria-label="On this page">
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {SECTIONS.map(([id, title]) => (
                  <li key={id}>
                    <a href={`#${id}`}>{title}</a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>

          <Section id="source">
            <p>
              The{' '}
              <a href={RW_USER_GUIDE} {...external}>
                Retraction Watch Database
              </a>{' '}
              records retractions, expressions of concern, corrections and reinstatements of scholarly papers. Retraction Watch finds and classifies
              the notices. Crossref acquired the database in 2023 and distributes it as a CSV file at{' '}
              <a href={DATA_SOURCE} {...external}>
                gitlab.com/crossref/retraction-watch-data
              </a>
              , updated each working day.
            </p>
            <p>
              The data is released under CC0, so anyone can use it without asking:{' '}
              <a href={CROSSREF_LICENSES} {...external}>
                Crossref’s license table
              </a>{' '}
              lists the Retraction Watch database under CC0. This site credits Retraction Watch on every page all the same.
            </p>
            {meta && (
              <p>
                This site shows the snapshot of {formatDataDate(meta.dataDate)} (commit <span className="font-mono">{meta.commit}</span>),
                with {formatNumber(meta.documents)} records.
              </p>
            )}
            <p>
              So that fields can be filtered, the site cleans some values. It splits lists of names, institutions, countries, subjects, article types and
              reasons into separate entries, reads the dates, and merges journal and publisher names that differ only in capitals or accents. Where cleaning
              changed a field, the record’s page shows the value as Retraction Watch published it.{' '}
              <a href={DATA_ISSUES} {...external}>
                The data issues found so far
              </a>{' '}
              explains what the cleaning changes and why.
            </p>
            <p>
              The caveats below come from Retraction Watch’s{' '}
              <a href={RW_USER_GUIDE} {...external}>
                user guide
              </a>{' '}
              and its note{' '}
              <a href={RW_METHODOLOGY} {...external}>
                How The Retraction Watch Database Was Constructed
              </a>
              .
            </p>
          </Section>

          <Section id="defaults">
            <p>
              Searches start with retractions only, without revised versions. Expressions of concern, corrections and reinstatements are counted in
              the notice-type filter, and revised versions under “Include revised versions”, so each is one click away. The summary above the results
              always states both defaults.
            </p>
            <p>Notices that list a journal’s editorial staff as the author are included by default. An option excludes them.</p>
          </Section>

          <Section id="counts">
            <ul className={list}>
              <li>Every number is an exact count of records in this snapshot, not an estimate.</li>
              <li>
                A record is one notice. A paper with several notices, such as a correction and later a retraction, has a record for each.
              </li>
              <li>
                In a filter that matches any of its selected values, the default, each value’s count is the number of records that match every other
                filter and have that value. It shows what selecting the value would add. In a filter set to match all of its values, each count also
                takes that filter’s own selection into account.
              </li>
              <li>
                Reasons, subjects, countries and article types can each hold several values for one record, so their counts add up to more than the
                total. Country counts overlap the most: see <a href="#countries">Countries</a>.
              </li>
              <li>“Unknown” is shown as its own value wherever Retraction Watch recorded it.</li>
              <li>
                With search text, the counts are for the records the text matches. When nothing matches exactly, the page says it’s showing close
                spellings, and the counts include them.
              </li>
            </ul>
          </Section>

          <Section id="notice-types">
            <p>
              Retraction Watch aims to record every retraction. It adds expressions of concern and corrections mainly when they relate to existing
              retractions, its blog posts or high-profile studies, so their counts are not representative. It also records reinstatements.
            </p>
            <p>
              An article removed entirely counts as a <strong>retraction</strong>, however long it was removed for, including “withdrawn” articles.{' '}
              <strong>Corrections</strong> include errata, corrigenda and partial retractions. <strong>Expressions of concern</strong> cover almost every
              other editorial notice. The site keeps the four types visibly apart.
            </p>
          </Section>

          <Section id="reasons">
            <p>
              Reasons are Retraction Watch’s classification. They come from the notice and from Retraction Watch’s own checks of its blog posts,
              institutional misconduct findings and press coverage. Retraction Watch updates them as new information arrives, so counts by reason can
              change, even for old retractions. A record can have several reasons.
            </p>
            <p>The colors group reasons by topic. The grouping is this site’s, not Retraction Watch’s, and it says nothing about severity.</p>
          </Section>

          <Section id="countries">
            <p>
              A record lists every country in its authors’ affiliations, so country counts overlap and add up to more than the number of records.
              When an affiliation is missing, Retraction Watch enters the country most associated with the authors at the time, so some countries
              are inferred.
            </p>
          </Section>

          <Section id="revisions">
            <p>
              When a preprint, guideline or review is revised under a new DOI, Retraction Watch enters the original and each revision, and the
              revisions have “Revision” in their article type. That can inflate counts for journals and author names, so revised versions are hidden
              from results and counts by default. “Include revised versions” adds them back.
            </p>
          </Section>

          <Section id="editorial-staff">
            <p>
              When a notice only amends an earlier notice, Retraction Watch lists the author as “Editorial Staff” with the journal’s name, the
              affiliation as the publisher, and the country as the publisher’s headquarters country. These notices can add to the counts for those
              countries and institutions. The option “Exclude notices that list the journal’s editorial staff as the author” removes them.
            </p>
          </Section>

          <Section id="dates">
            <p>Dates are approximate below the year:</p>
            <ul className={list}>
              <li>An unknown day is recorded as the 1st, and a range of months as its first month.</li>
              <li>Seasons and volume numbers are mapped to months.</li>
              <li>
                When a publisher replaced the article’s page with the notice, the paper and the notice get the same date, so the time to retraction
                reads as zero.
              </li>
              <li>When a notice’s real date couldn’t be found, the date Retraction Watch found the notice is used instead.</li>
            </ul>
          </Section>

          <Section id="paywalled">
            <p>
              “Paywalled” describes the notice, not the paper. It means a subscription was needed to see the notice’s title or reason. It says nothing
              about whether the paper itself is open.
            </p>
          </Section>

          <Section id="coverage">
            <p>
              The database started from PubMed and is checked against Web of Science, Scopus, publishers’ sites and readers’ tips. Retractions without
              a notice, where an article simply disappears, are found mostly through tips. A paper missing from the database may still have been
              retracted.
            </p>
            <p>
              Because the database started from PubMed, coverage may differ between fields. This site hasn’t measured that, so compare subjects with
              care.
            </p>
          </Section>

          <Section id="author-names">
            <p>
              Author names are matched as names, not as people. Different people can share a name, and the same person may appear under other
              spellings or with initials. A name match ignores capitals, accents and punctuation. The site doesn’t count, rank or profile authors.
            </p>
          </Section>

          <Section id="missing">
            <p>
              Retraction Watch keeps the database, so additions go to them. If you know of a retraction that isn’t in it, use the form linked from
              Retraction Watch’s{' '}
              <a href={RW_USER_GUIDE} {...external}>
                user guide
              </a>
              . The form isn’t for papers you think should be retracted; the guide gives a separate address for those.
            </p>
            <p>An addition shows here once Retraction Watch has made it and this site has loaded a newer snapshot.</p>
          </Section>

          <Section id="site-problems">
            <p>
              For a problem with this site rather than the data, such as a wrong count or a broken page,{' '}
              <a href={issueUrl({ title: 'Problem with this site', dataDate: meta ? formatDataDate(meta.dataDate) : undefined })} {...external}>
                open an issue on GitHub
              </a>
              . The site’s{' '}
              <a href={REPOSITORY} {...external}>
                code
              </a>{' '}
              is open source under the MIT license.
            </p>
            <p>
              <Link href="/">Back to the search</Link>
            </p>
          </Section>
        </article>
      </main>
    </>
  );
}
