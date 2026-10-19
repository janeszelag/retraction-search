'use client';

// A result's links and its "All fields" panel, which expands in place so every
// field of the record can be seen without a new search (spec 002 AC18).
import Link from 'next/link';
import { useState } from 'react';
import { ui } from '@/components/ui';

export function ResultFields({
  recordId,
  noticeDoi,
  paperDoi,
  fields,
}: {
  recordId: number;
  noticeDoi: string | null;
  paperDoi: string | null;
  // Label and value, in order; values in monospace are identifiers.
  fields: { label: string; value: string; mono?: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-[18px] text-sm">
        {noticeDoi && (
          <a href={`https://doi.org/${noticeDoi}`} target="_blank" rel="noopener">
            Notice
          </a>
        )}
        {paperDoi && (
          <a href={`https://doi.org/${paperDoi}`} target="_blank" rel="noopener">
            Paper
          </a>
        )}
        <Link href={`/record/${recordId}`} className={ui.link} prefetch={false}>
          Record page
        </Link>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={ui.link}>
          {open ? 'Fewer fields' : 'All fields'}
        </button>
      </div>
      {open && (
        <dl className="mt-2.5 grid grid-cols-[minmax(130px,max-content)_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-md bg-ink-25 p-3.5 text-[13px]">
          {fields.map((field) => (
            <div key={field.label} className="contents">
              <dt className="text-ink-600">{field.label}</dt>
              <dd className={field.mono ? 'font-mono break-all' : ''}>{field.value}</dd>
            </div>
          ))}
          <dt className="text-ink-600">Institutions and notes</dt>
          <dd>
            <Link href={`/record/${recordId}`} className={`${ui.link} min-h-0 p-0 text-[13px]`} prefetch={false}>
              On the record page
            </Link>
          </dd>
        </dl>
      )}
    </>
  );
}
