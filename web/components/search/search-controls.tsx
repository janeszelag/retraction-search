'use client';

// The search box and "Search in a field" (spec 002 AC10, AC11), as in the
// prototype. Typed text updates the URL after a pause, so each keystroke isn't
// a search toward the visitor's rate limit (decision record 003).
import Form from 'next/form';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchNavigation } from '@/components/filters/pending';
import { CloseIcon } from '@/components/icons';
import { SelectMenu } from '@/components/select-menu';
import { ui } from '@/components/ui';
import { TERM_FIELDS, type Match, type Query, type TermField } from '@/lib/query/types';
import { queryHref, serializeQuery } from '@/lib/query/url';

const TYPING_PAUSE_MS = 300;

const FIELD_LABELS: Record<TermField, string> = {
  title: 'Title',
  author: 'Author name',
  institution: 'Institution',
  journal: 'Journal',
  publisher: 'Publisher',
};

interface Row {
  field: TermField;
  words: string;
  exclude: boolean;
}

const toRows = (query: Query): Row[] => query.terms.map(({ field, words, exclude }) => ({ field, words, exclude }));

// The query with these rows; rows without words aren't part of it yet.
function withRows(query: Query, rows: Row[], termMatch = query.termMatch): Query {
  return {
    ...query,
    terms: rows.filter((row) => row.words.trim()).map((row) => ({ ...row, words: row.words.trim().replace(/\s+/g, ' ') })),
    termMatch,
    page: 1,
  };
}

export function SearchControls({ query }: { query: Query }) {
  const navigate = useSearchNavigation();
  const [text, setText] = useState(query.q);
  const [rows, setRows] = useState<Row[]>(toRows(query));
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What this component last sent, so a page that arrives while someone is
  // still typing doesn't overwrite what they've typed since.
  const sent = useRef({ q: query.q, terms: serializeQuery({ ...query, page: 1 }) });

  useEffect(() => {
    if (query.q !== sent.current.q) {
      setText(query.q);
      sent.current.q = query.q;
    }
    const terms = serializeQuery({ ...query, page: 1 });
    if (terms !== sent.current.terms) {
      setRows((current) => {
        const fromUrl = toRows(query);
        // Keep rows still being written, which aren't in the URL yet.
        return [...fromUrl, ...current.filter((row) => !row.words.trim())];
      });
      sent.current.terms = terms;
    }
  }, [query]);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  const go = (next: Query, wait: boolean) => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    const send = () => {
      sent.current = { q: next.q, terms: serializeQuery({ ...next, page: 1 }) };
      navigate(queryHref(next));
    };
    if (wait) {
      timer.current = setTimeout(send, TYPING_PAUSE_MS);
    } else {
      send();
    }
  };

  const changeRows = (next: Row[], wait: boolean, termMatch?: Record<TermField, Match>) => {
    setRows(next);
    const nextQuery = withRows({ ...query, q: text.trim() }, next, termMatch);
    if (serializeQuery(nextQuery) !== serializeQuery({ ...query, page: 1 })) {
      go(nextQuery, wait);
    }
  };

  const filled = query.terms;
  const modeFields = TERM_FIELDS.filter((field) => rows.filter((row) => row.field === field && !row.exclude && row.words.trim()).length > 1);
  // The filters and field terms a new search keeps, for the form without JavaScript.
  const kept = [...new URLSearchParams(serializeQuery({ ...query, q: '', page: 1 }))];

  return (
    <div className="flex flex-col gap-1.5 mt-10">
      <Form
        action="/"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          go({ ...withRows(query, rows), q: text.trim() }, false);
        }}
      >
        <label htmlFor="q" className="sr-only">
          Search
        </label>
        <input
          id="q"
          name="q"
          type="search"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            go({ ...withRows(query, rows), q: event.target.value.trim() }, true);
          }}
          placeholder="Search titles, author names, journals and publishers, or paste a DOI or PubMed ID"
          className={`${ui.input} min-h-12 text-base`}
        />
        {kept.map(([name, value], index) => (
          <input key={`${name}-${index}`} type="hidden" name={name} value={value} />
        ))}
      </Form>

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            if (open) {
              setRows(rows.filter((row) => row.words.trim()));
            } else if (rows.length === 0) {
              setRows([{ field: 'title', words: '', exclude: false }]);
            }
            setOpen(!open);
          }}
          className={`${ui.link} text-[13px]`}
        >
          {open ? 'Hide field search' : `Search in a field${filled.length > 0 ? ` (${filled.length})` : ''}`}
        </button>
        {!open &&
          filled.map((term, index) => (
            <span key={`${term.field}-${term.exclude}-${term.words}`} className={term.exclude ? `${ui.chip} border-exclude-line bg-exclude-soft` : ui.chip}>
              <span className="mr-1 text-xs text-ink-600">{FIELD_LABELS[term.field]}</span>
              {term.exclude ? `not “${term.words}”` : `“${term.words}”`}
              <Link
                href={queryHref({ ...query, terms: filled.filter((_, other) => other !== index), page: 1 })}
                aria-label={`Remove ${FIELD_LABELS[term.field]} term ${term.words}`}
                className={ui.chipRemove}
                prefetch={false}
                scroll={false}
              >
                <CloseIcon />
              </Link>
            </span>
          ))}
      </div>

      {open && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-ink-150 bg-ink-25 px-4 py-3.5">
          <p className="text-[13.5px] leading-[1.45] text-ink-700">
            Look for words in one field, such as a title word, an author’s name or an institution. A row matches records where all its words
            appear somewhere in that field, in any order. Add a row for each term. Results must match every row; when two rows use the same
            field, choose whether results need any or all of them. The filters on the left narrow the results further.
          </p>
          {rows.map((row, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <SelectMenu
                value={row.field}
                label={`Field, row ${index + 1}`}
                className="w-[150px]"
                onValueChange={(field) => changeRows(rows.map((other, at) => (at === index ? { ...other, field: field as TermField } : other)), false)}
                options={TERM_FIELDS.map((field) => ({ value: field, label: FIELD_LABELS[field] }))}
              />
              <SelectMenu
                value={row.exclude ? 'exclude' : 'include'}
                label={`Contains or not, row ${index + 1}`}
                className="w-[172px]"
                onValueChange={(mode) => changeRows(rows.map((other, at) => (at === index ? { ...other, exclude: mode === 'exclude' } : other)), false)}
                options={[
                  { value: 'include', label: 'contains' },
                  { value: 'exclude', label: 'doesn’t contain' },
                ]}
              />
              <input
                value={row.words}
                aria-label={`Word or phrase, row ${index + 1}`}
                placeholder="A word or phrase"
                onChange={(event) => changeRows(rows.map((other, at) => (at === index ? { ...other, words: event.target.value } : other)), true)}
                className={`${ui.input} w-auto flex-[1_1_200px]`}
              />
              <button
                type="button"
                aria-label={`Remove row ${index + 1}`}
                title="Remove row"
                onClick={() => changeRows(rows.filter((_, at) => at !== index), false)}
                className="grid h-8 w-8 flex-none place-items-center rounded text-[#5b6572] hover:bg-ink-100 hover:text-ink-950"
              >
                <CloseIcon size={14} />
              </button>
            </div>
          ))}
          {modeFields.map((field) => (
            <div key={field} className="flex flex-wrap items-center gap-2 text-[13px] text-ink-700">
              {FIELD_LABELS[field]}: results need
              <div role="group" aria-label={`${FIELD_LABELS[field]} terms`} className="flex">
                {(['any', 'all'] as const).map((match, position) => {
                  const on = query.termMatch[field] === match;
                  return (
                    <button
                      key={match}
                      type="button"
                      aria-pressed={on}
                      onClick={() => changeRows(rows, false, { ...query.termMatch, [field]: match })}
                      className={`min-h-8 border px-3 text-[13px] font-semibold ${position === 0 ? 'rounded-l-md' : 'rounded-r-md border-l-0'} ${
                        on ? 'border-ink-950 bg-ink-950 text-white' : 'border-ink-300 bg-white'
                      }`}
                    >
                      {match}
                    </button>
                  );
                })}
              </div>
              of these terms
            </div>
          ))}
          {/* "Hide field search" above closes the panel, so it needs no Done button of its own. */}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={ui.btn} onClick={() => setRows([...rows, { field: 'title', words: '', exclude: false }])}>
              Add a row
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
