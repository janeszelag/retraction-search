// The plain-language summary of a query (spec 002 AC15), the total by notice
// type (AC17) and the citation line (AC24).
import { formatDataDate } from '../format/dates';
import { formatNumber } from '../format/numbers';
import { identifierLookup } from './identifier';
import { categoryLabel, parseSubjectValue } from './subjects';
import {
  TERM_FIELDS,
  emptySelection,
  type FilterKey,
  type Match,
  type Query,
  type TermField,
  type YearRange,
} from './types';

export interface SummaryPart {
  text: string;
  // The query without this part, or null for a part that can't be removed.
  remove: Query | null;
}

export interface Summary {
  parts: SummaryPart[];
  sentence: string;
}

// Notice types in the order totals list them.
export const NOTICE_TYPES = ['Retraction', 'Expression of concern', 'Correction', 'Reinstatement'];

const NOTICE_TYPE_WORDS: Record<string, [string, string]> = {
  Retraction: ['retraction', 'retractions'],
  'Expression of concern': ['expression of concern', 'expressions of concern'],
  Correction: ['correction', 'corrections'],
  Reinstatement: ['reinstatement', 'reinstatements'],
};

export function noticeTypeWord(type: string, count: number): string {
  const [one, many] = NOTICE_TYPE_WORDS[type] ?? [type.toLowerCase(), type.toLowerCase()];
  return count === 1 ? one : many;
}

// "A", "A or B", "A, B or C"
export function joinList(items: string[], conjunction: 'and' | 'or'): string {
  if (items.length < 2) {
    return items.join('');
  }
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items.at(-1)}`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const quoted = (text: string) => `“${text}”`;

// Every change resets the page, since the old page number belongs to other results.
function changed(query: Query, change: (draft: Query) => void): Query {
  const draft = structuredClone(query);
  change(draft);
  draft.page = 1;
  return draft;
}

const TERM_FIELD_NOUNS: Record<TermField, [string, string]> = {
  title: ['a title', 'title'],
  author: ['an author name', 'author name'],
  institution: ['an institution', 'institution'],
  journal: ['a journal name', 'journal name'],
  publisher: ['a publisher name', 'publisher name'],
};

function termText(words: string): string {
  return words.includes(' ') ? `the words ${quoted(words)}` : quoted(words);
}

// What each filter's included and excluded values read as.
const FILTER_PHRASES: Partial<Record<FilterKey, [string, string]>> = {
  reason: ["where Retraction Watch's reasons include ", "where Retraction Watch's reasons don't include "],
  country: ['with an author listed in ', 'with no author listed in '],
  publisher: ['published by ', 'not published by '],
  journal: ['in the journal ', 'not in the journal '],
  article_type: ['with the article type ', 'excluding the article type '],
};

const PAYWALL_INCLUDED: Record<string, string> = {
  Yes: 'a paywalled notice',
  No: "a notice that isn't paywalled",
  Unknown: 'an unknown paywall status',
};
const PAYWALL_EXCLUDED: Record<string, string> = {
  Yes: 'paywalled notices',
  No: "notices that aren't paywalled",
  Unknown: 'unknown paywall status',
};

// "Basic Life Sciences (BLS) or the subject Neuroscience (BLS)"
function subjectList(values: string[], match: Match): string {
  const categories: string[] = [];
  const subjects: string[] = [];
  for (const value of values) {
    const subject = parseSubjectValue(value);
    if (subject.kind === 'category') {
      categories.push(categoryLabel(subject.code));
    } else {
      subjects.push(`${subject.name} (${subject.code})`);
    }
  }
  const items = [...categories];
  if (subjects.length > 0) {
    items.push(`${subjects.length === 1 ? 'the subject' : 'the subjects'} ${joinList(subjects, match === 'all' ? 'and' : 'or')}`);
  }
  return joinList(items, match === 'all' ? 'and' : 'or');
}

function yearsText(range: YearRange, noun: string): string | null {
  const { from, to } = range;
  if (from === null && to === null) {
    return null;
  }
  if (from !== null && to !== null) {
    return from === to ? `${noun} in ${from}` : `${noun} from ${from} to ${to}`;
  }
  return from !== null ? `${noun} from ${from} on` : `${noun} up to ${to}`;
}

function finish(parts: SummaryPart[]): Summary {
  const shown = parts.map((part, index) => ({ ...part, text: index === 0 ? capitalize(part.text) : part.text }));
  return { parts: shown, sentence: `${shown.map((part) => part.text).join(', ')}.` };
}

export function describeQuery(query: Query): Summary {
  const parts: SummaryPart[] = [];

  const lookup = identifierLookup(query.q);
  if (lookup) {
    const what = lookup.kind === 'doi' ? `the DOI ${lookup.value}` : `the PubMed ID ${lookup.value}`;
    parts.push({ text: `records whose notice or paper has ${what}`, remove: changed(query, (draft) => (draft.q = '')) });
    parts.push({ text: 'with filters ignored, as for every identifier lookup', remove: null });
    return finish(parts);
  }

  const type = query.filters.type;
  const everyType = type.include.length === 0 && type.exclude.length === 0;
  const plural = (types: string[]) => types.map((value) => noticeTypeWord(value, 2));
  const head = type.include.length > 0 ? joinList(plural(type.include), 'and') : 'all notice types';
  parts.push({
    text: type.exclude.length > 0 ? `${head} except ${joinList(plural(type.exclude), 'and')}` : head,
    remove: everyType ? null : changed(query, (draft) => (draft.filters.type = emptySelection())),
  });

  parts.push(
    query.revisions === 'exclude'
      ? { text: 'excluding revised versions', remove: changed(query, (draft) => (draft.revisions = 'include')) }
      : { text: 'including revised versions', remove: changed(query, (draft) => (draft.revisions = 'exclude')) },
  );
  if (query.editorialStaff === 'exclude') {
    parts.push({
      text: 'excluding notices with editorial staff as the author',
      remove: changed(query, (draft) => (draft.editorialStaff = 'include')),
    });
  }

  if (query.q) {
    parts.push({ text: `matching ${quoted(query.q)}`, remove: changed(query, (draft) => (draft.q = '')) });
  }

  for (const field of TERM_FIELDS) {
    const [withNoun, noNoun] = TERM_FIELD_NOUNS[field];
    for (const exclude of [false, true]) {
      const terms = query.terms.filter((term) => term.field === field && term.exclude === exclude);
      if (terms.length === 0) {
        continue;
      }
      const conjunction = !exclude && query.termMatch[field] === 'all' ? 'and' : 'or';
      const list = joinList(terms.map((term) => termText(term.words)), conjunction);
      parts.push({
        text: exclude ? `with no ${noNoun} containing ${list}` : `with ${withNoun} containing ${list}`,
        remove: changed(query, (draft) => {
          draft.terms = draft.terms.filter((term) => term.field !== field || term.exclude !== exclude);
          if (!exclude) {
            draft.termMatch[field] = 'any';
          }
        }),
      });
    }
  }

  for (const name of query.authorNames) {
    parts.push({
      text: `listing the author name ${quoted(name)}`,
      remove: changed(query, (draft) => (draft.authorNames = draft.authorNames.filter((other) => other !== name))),
    });
  }

  for (const key of ['reason', 'subject', 'country', 'publisher', 'journal', 'article_type', 'paywalled'] as const) {
    const selection = query.filters[key];
    const conjunction = selection.match === 'all' ? 'and' : 'or';
    const removeIncluded = changed(query, (draft) => {
      draft.filters[key].include = [];
      draft.filters[key].match = 'any';
    });
    const removeExcluded = changed(query, (draft) => (draft.filters[key].exclude = []));
    if (key === 'subject') {
      if (selection.include.length > 0) {
        parts.push({ text: `in ${subjectList(selection.include, selection.match)}`, remove: removeIncluded });
      }
      if (selection.exclude.length > 0) {
        parts.push({ text: `outside ${subjectList(selection.exclude, 'any')}`, remove: removeExcluded });
      }
    } else if (key === 'paywalled') {
      if (selection.include.length > 0) {
        parts.push({
          text: `with ${joinList(selection.include.map((value) => PAYWALL_INCLUDED[value] ?? value), 'or')}`,
          remove: removeIncluded,
        });
      }
      if (selection.exclude.length > 0) {
        parts.push({
          text: `excluding ${joinList(selection.exclude.map((value) => PAYWALL_EXCLUDED[value] ?? value), 'and')}`,
          remove: removeExcluded,
        });
      }
    } else {
      const [included, excluded] = FILTER_PHRASES[key]!;
      if (selection.include.length > 0) {
        parts.push({ text: included + joinList(selection.include, conjunction), remove: removeIncluded });
      }
      if (selection.exclude.length > 0) {
        parts.push({ text: excluded + joinList(selection.exclude, 'or'), remove: removeExcluded });
      }
    }
  }

  const noticeYears = yearsText(query.noticeYears, 'with notices');
  if (noticeYears) {
    parts.push({ text: noticeYears, remove: changed(query, (draft) => (draft.noticeYears = { from: null, to: null })) });
  }
  const paperYears = yearsText(query.paperYears, 'for papers published');
  if (paperYears) {
    parts.push({ text: paperYears, remove: changed(query, (draft) => (draft.paperYears = { from: null, to: null })) });
  }

  return finish(parts);
}

// "1,234 retractions", or "1,200 retractions and 34 expressions of concern".
// A set with several notice types is never counted as retractions (AC17).
export function totalPhrase(totals: Record<string, number>): string {
  const known = NOTICE_TYPES.filter((type) => totals[type]);
  const others = Object.keys(totals)
    .filter((type) => !NOTICE_TYPES.includes(type) && totals[type])
    .sort();
  const bits = [...known, ...others].map((type) => `${formatNumber(totals[type])} ${noticeTypeWord(type, totals[type])}`);
  return bits.length > 0 ? joinList(bits, 'and') : 'No matching records';
}

// ISSNs checked 2026-10-13: the database's in Retraction Watch's user guide,
// the blog's in the ISSN portal.
export const DATABASE_ISSN = '2692-4579';
export const BLOG_ISSN = '2692-465X';

// One line to paste into a story or a paper (AC24).
export function citation({
  query,
  totals,
  dataDate,
  url,
}: {
  query: Query;
  totals: Record<string, number>;
  dataDate: string;
  url: string;
}): string {
  return (
    `${totalPhrase(totals)}. ${describeQuery(query).sentence} ` +
    `Source: Retraction Watch Database (ISSN ${DATABASE_ISSN}), data as of ${formatDataDate(dataDate)}; ` +
    `Retraction Watch blog (ISSN ${BLOG_ISSN}). Searched at ${url}`
  );
}
