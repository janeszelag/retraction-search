'use client';

// A result's author names (spec 002 AC14, AC18): the first ten, plus any
// further down that matched the search, with the rest one click away. Each
// name links to the records that list it, as a name match.
import Link from 'next/link';
import { useState } from 'react';
import { ui } from '@/components/ui';
import { addAuthorName } from '@/lib/query/changes';
import type { Query } from '@/lib/query/types';
import { queryHref } from '@/lib/query/url';
import type { Segment } from '@/lib/search/types';
import { Highlighted } from './highlighted';

const SHOWN = 10;

export function AuthorList({
  query,
  authors,
  segments,
  matched,
}: {
  query: Query;
  authors: string[];
  segments: Segment[][];
  matched: number[];
}) {
  const [all, setAll] = useState(false);
  const shown = [...authors.keys()].slice(0, all ? authors.length : SHOWN);
  const later = all ? [] : matched.filter((index) => index >= SHOWN);
  const listed = [...shown, ...later];
  return (
    <p className="mt-1 text-sm text-ink-800">
      <span className="text-ink-600">Author names: </span>
      {listed.map((index, position) => (
        <span key={index}>
          {position === shown.length && later.length > 0 && <span>… </span>}
          <Link
            href={queryHref(addAuthorName(query, authors[index]))}
            title="Show records that list this name"
            aria-label={`Show records that list the name ${authors[index]}`}
            className="text-inherit decoration-[#c3cad3] underline-offset-[3px] hover:text-accent hover:decoration-accent"
            prefetch={false}
          >
            <Highlighted segments={segments[index]} />
          </Link>
          {position < listed.length - 1 && ', '}
        </span>
      ))}
      {authors.length > SHOWN && (
        <button type="button" onClick={() => setAll(!all)} className={`${ui.link} min-h-0 py-0 pl-2 text-[13px]`}>
          {all ? 'Show fewer names' : `Show all ${authors.length} names`}
        </button>
      )}
      {matched.length > 0 && (
        <span className={`${ui.tag} ml-2 border-accent-line bg-accent-soft text-[#1b3f6e]`} title="The search matched a name. Names are not identities.">
          Name match
        </span>
      )}
    </p>
  );
}
