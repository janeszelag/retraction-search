'use client';

import { useState } from 'react';
import { ui } from '@/components/ui';
import { formatNumber } from '@/lib/format/numbers';
import { clearFilter } from '@/lib/query/changes';
import { categoryLabel, parseSubjectValue } from '@/lib/query/subjects';
import type { Query } from '@/lib/query/types';
import { queryHref } from '@/lib/query/url';
import type { ValueCount } from '@/lib/search/types';
import { MatchSwitch, SectionHead } from './facet-section';
import { ValueRow } from './value-row';

// Subjects shown under an open group before "more in …".
const CHILD_LIMIT = 10;
const FIND_LIMIT = 40;

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d={open ? 'M2.5 4.5l3.5 3.5 3.5-3.5' : 'M4.5 2.5L8 6l-3.5 3.5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Retraction Watch's seven subject groups, each opening to its subjects. A
// whole group can be selected at once (spec 002 AC7).
export function SubjectSection({
  query,
  categories,
  subjects,
  note,
}: {
  query: Query;
  categories: ValueCount[];
  subjects: ValueCount[];
  note: string;
}) {
  const selection = query.filters.subject;
  const selected = new Set([...selection.include, ...selection.exclude]);
  const [find, setFind] = useState('');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const needle = find.trim().toLowerCase();

  // Selected values stay visible even at 0.
  const withSelected = (list: ValueCount[], keep: (value: string) => boolean) => {
    const out = [...list];
    for (const value of selected) {
      if (keep(value) && !out.some((entry) => entry.value === value)) {
        out.push({ value, count: 0 });
      }
    }
    return out;
  };
  const groups = withSelected(categories, (value) => parseSubjectValue(value).kind === 'category').sort((a, b) => b.count - a.count);
  const allSubjects = withSelected(subjects, (value) => parseSubjectValue(value).kind === 'subject').sort((a, b) => b.count - a.count);
  const subjectName = (value: string) => {
    const subject = parseSubjectValue(value);
    return subject.kind === 'subject' ? subject.name : value;
  };

  const found = needle
    ? allSubjects.filter((entry) => `${subjectName(entry.value)} (${parseSubjectValue(entry.value).code})`.toLowerCase().includes(needle))
    : [];

  return (
    <section className="border-t border-[#e3e6ea] py-3.5">
      <SectionHead
        title="Subject"
        clearHref={selected.size > 0 ? queryHref(clearFilter(query, 'subject')) : null}
        note={note}
      />
      <input
        type="search"
        value={find}
        onChange={(event) => setFind(event.target.value)}
        aria-label="Search subject values"
        placeholder="Find a subject"
        className={`${ui.input} my-1.5 min-h-[34px] text-sm`}
      />
      {selection.include.length > 1 && <MatchSwitch query={query} facet="subject" />}
      {needle ? (
        <>
          <ul className="mt-1 flex list-none flex-col gap-px">
            {found.slice(0, FIND_LIMIT).map((entry) => (
              <li key={entry.value}>
                <ValueRow
                  query={query}
                  facet="subject"
                  value={entry.value}
                  label={`${subjectName(entry.value)} (${parseSubjectValue(entry.value).code})`}
                  count={entry.count}
                />
              </li>
            ))}
          </ul>
          {found.length === 0 && <p className="mt-1.5 text-[13px] text-ink-600">No subject values match “{find.trim()}”.</p>}
        </>
      ) : (
        <ul className="mt-1 flex list-none flex-col gap-px">
          {groups.map((group) => {
            const code = group.value;
            const children = allSubjects.filter((entry) => parseSubjectValue(entry.value).code === code);
            const picked = children.some((entry) => selected.has(entry.value));
            const open = openGroups[code] ?? picked;
            const shown = children.slice(0, CHILD_LIMIT);
            for (const entry of children.slice(CHILD_LIMIT)) {
              if (selected.has(entry.value)) {
                shown.push(entry);
              }
            }
            const label = categoryLabel(code);
            return (
              <li key={code}>
                <ValueRow
                  query={query}
                  facet="subject"
                  value={code}
                  label={label}
                  count={group.count}
                  before={
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-label={`${open ? 'Hide' : 'Show'} subjects in ${label}`}
                      onClick={() => setOpenGroups({ ...openGroups, [code]: !open })}
                      className="grid h-8 w-[26px] flex-none place-items-center rounded text-ink-700 hover:bg-ink-100"
                    >
                      <Chevron open={open} />
                    </button>
                  }
                />
                {open && (
                  <ul className="mb-1 ml-[34px] list-none border-l-2 border-[#e3e6ea] pl-1.5">
                    {shown.map((entry) => (
                      <li key={entry.value}>
                        <ValueRow query={query} facet="subject" value={entry.value} label={subjectName(entry.value)} count={entry.count} />
                      </li>
                    ))}
                    {children.length > CHILD_LIMIT && (
                      <li className="px-1.5 py-1 text-xs text-ink-600">
                        {formatNumber(children.length - CHILD_LIMIT)} more in {label}. Search subjects to find them.
                      </li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!needle && groups.length === 0 && <p className="mt-1.5 text-[13px] text-ink-600">No values for these results.</p>}
    </section>
  );
}
