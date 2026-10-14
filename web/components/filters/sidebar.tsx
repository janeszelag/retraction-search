// The filter sidebar, in the plan's order (plan 002, "Layout"). A server
// component that hands each section its values; the sections themselves are
// client components, rendered to HTML on the server too, so every filter link
// works without JavaScript.
import { reasonGroup } from '@/lib/format/reasons';
import { setEditorialStaff, setRevisions } from '@/lib/query/changes';
import { NOTICE_TYPES } from '@/lib/query/describe';
import { DEFAULT_NOTICE_TYPE, type FilterKey, type Query } from '@/lib/query/types';
import { queryHref } from '@/lib/query/url';
import type { FacetCounts, ValueCount } from '@/lib/search/types';
import { FacetSection, SectionHead, type FacetValue } from './facet-section';
import { SubjectSection } from './subject-section';
import { OptionRow } from './value-row';
import { YearSection } from './year-section';

// The data caveats each filter states (spec 002 AC9), as the prototype words them.
const NOTES = {
  type: 'Retraction Watch aims to record every retraction. It adds expressions of concern and corrections selectively, so their counts are not representative.',
  reason:
    "Retraction Watch's classification, which it updates as new information arrives. Colors group reasons by topic; the grouping is this site's, not Retraction Watch's.",
  subject: "Retraction Watch's seven subject groups, each with its subjects. A record can have subjects in several groups.",
  country: "A record lists every author's country, so these counts overlap and add up to more than the results.",
  paywalled: 'Whether a subscription was needed to see the notice. It says nothing about the paper.',
  noticeYears: 'The year of the notice. Dates below the year are approximate.',
  // The prototype's note left out the caveat that AC9 asks every year filter to state.
  paperYears: 'The year the original paper was published. Dates below the year are approximate.',
  revisions: 'Revised preprints, guidelines and reviews are separate entries, so they are hidden by default to avoid double counting.',
};

const PAYWALL_LABELS: Record<string, string> = { No: 'Not paywalled', Yes: 'Paywalled', Unknown: 'Unknown' };

// The counts for a filter, with selected values added at 0 so they stay visible (AC6).
function withSelected(query: Query, facet: FilterKey, counts: ValueCount[] = []): ValueCount[] {
  const out = [...counts];
  const { include, exclude } = query.filters[facet];
  for (const value of [...include, ...exclude]) {
    if (!out.some((entry) => entry.value === value)) {
      out.push({ value, count: 0 });
    }
  }
  return out;
}

const inOrder = (order: string[]) => (a: ValueCount, b: ValueCount) => {
  const rank = (value: string) => (order.includes(value) ? order.indexOf(value) : order.length);
  return rank(a.value) - rank(b.value) || a.value.localeCompare(b.value);
};

const countOf = (counts: ValueCount[] | undefined, value: string) => counts?.find((entry) => entry.value === value)?.count ?? 0;

export function FilterSidebar({ query, counts, lastYear }: { query: Query; counts: FacetCounts; lastYear: number }) {
  const plain = (facet: FilterKey, list?: ValueCount[]): FacetValue[] =>
    withSelected(query, facet, list).map(({ value, count }) => ({ value, label: value, count }));

  const noticeTypes = withSelected(query, 'type', counts.notice_type)
    .sort(inOrder(NOTICE_TYPES))
    .map(({ value, count }) => ({ value, label: value, count }));
  const type = query.filters.type;
  const defaultType = type.include.length === 1 && type.include[0] === DEFAULT_NOTICE_TYPE && type.exclude.length === 0;

  const reasons = withSelected(query, 'reason', counts.reasons).map(({ value, count }) => {
    const group = reasonGroup(value);
    return {
      value,
      label: value,
      count,
      after: <span aria-hidden="true" title={group.name} className={`h-2.5 w-2.5 flex-none rounded-[3px] ${group.dotClass}`} />,
    };
  });

  const paywalled = withSelected(query, 'paywalled', counts.paywalled)
    .sort(inOrder(['No', 'Yes', 'Unknown']))
    .map(({ value, count }) => ({ value, label: PAYWALL_LABELS[value] ?? value, count }));

  return (
    <div>
      <h2 className="filters-heading mb-1 text-[13px] font-bold tracking-[0.06em] text-ink-600 uppercase">Filters</h2>
      <FacetSection
        query={query}
        facet="type"
        title="Notice type"
        note={NOTES.type}
        noteHref="/about#notice-types"
        values={noticeTypes}
        show={4}
        listField={false}
        findPlaceholder="Find a notice type"
        isDefault={defaultType}
      />
      <section className="pt-0.5 pb-3">
        <OptionRow
          href={queryHref(setRevisions(query, query.revisions === 'include' ? 'exclude' : 'include'))}
          on={query.revisions === 'include'}
          label="Include revised versions"
          count={countOf(counts.is_revision, 'true')}
        />
        <p className="mt-0.5 ml-8 text-[12.5px] leading-[1.4] text-ink-600">{NOTES.revisions}</p>
      </section>
      <FacetSection
        query={query}
        facet="reason"
        title="Reason"
        note={NOTES.reason}
        noteHref="/about#reasons"
        values={reasons}
        show={6}
        listField
        findPlaceholder="Find a reason"
      />
      <SubjectSection query={query} categories={counts.subject_categories ?? []} subjects={counts.subjects ?? []} note={NOTES.subject} />
      <FacetSection
        query={query}
        facet="country"
        title="Country"
        note={NOTES.country}
        noteHref="/about#countries"
        values={plain('country', counts.countries)}
        show={6}
        listField
        findPlaceholder="Find a country"
      />
      <YearSection
        query={query}
        which="noticeYears"
        title="Notice year"
        note={NOTES.noticeYears}
        noteHref="/about#dates"
        counts={counts.notice_year ?? []}
        lastYear={lastYear}
      />
      <YearSection
        query={query}
        which="paperYears"
        title="Paper year"
        note={NOTES.paperYears}
        noteHref="/about#dates"
        counts={counts.paper_year ?? []}
        lastYear={lastYear}
      />
      <FacetSection
        query={query}
        facet="article_type"
        title="Article type"
        values={plain('article_type', counts.article_types)}
        show={5}
        listField
        findPlaceholder="Find an article type"
      />
      <FacetSection
        query={query}
        facet="journal"
        title="Journal"
        values={plain('journal', counts.journal)}
        show={6}
        listField={false}
        findPlaceholder="Find a journal"
        topOnly
      />
      <FacetSection
        query={query}
        facet="publisher"
        title="Publisher"
        values={plain('publisher', counts.publisher)}
        show={6}
        listField={false}
        findPlaceholder="Find a publisher"
        topOnly
      />
      <FacetSection
        query={query}
        facet="paywalled"
        title="Notice paywalled"
        note={NOTES.paywalled}
        noteHref="/about#paywalled"
        values={paywalled}
        show={3}
        listField={false}
        findPlaceholder="Find a value"
      />
      <section className="border-t border-[#e3e6ea] py-3.5">
        <SectionHead title="Editorial-staff notices" />
        <OptionRow
          href={queryHref(setEditorialStaff(query, query.editorialStaff === 'exclude' ? 'include' : 'exclude'))}
          on={query.editorialStaff === 'exclude'}
          label="Exclude notices that list the journal's editorial staff as the author"
          count={countOf(counts.has_editorial_staff_author, 'true')}
        />
      </section>
    </div>
  );
}
