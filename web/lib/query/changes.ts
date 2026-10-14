// The query a filter control leads to. Pure, and safe in client components:
// filter links are built from these on the server and in the browser alike.
import { emptySelection, type FilterKey, type Match, type Query, type YearRange } from './types';

function changed(query: Query, change: (draft: Query) => void): Query {
  const draft = structuredClone(query);
  change(draft);
  // A filter change starts again on the first page.
  draft.page = 1;
  return draft;
}

// "all" only means something with two or more included values.
function settle(draft: Query, key: FilterKey) {
  if (draft.filters[key].include.length < 2) {
    draft.filters[key].match = 'any';
  }
}

// Selecting a value includes it, or stops including it.
export function toggleInclude(query: Query, key: FilterKey, value: string): Query {
  return changed(query, (draft) => {
    const selection = draft.filters[key];
    selection.exclude = selection.exclude.filter((other) => other !== value);
    selection.include = selection.include.includes(value)
      ? selection.include.filter((other) => other !== value)
      : [...selection.include, value];
    settle(draft, key);
  });
}

// The minus button excludes a value, or stops excluding it.
export function toggleExclude(query: Query, key: FilterKey, value: string): Query {
  return changed(query, (draft) => {
    const selection = draft.filters[key];
    selection.include = selection.include.filter((other) => other !== value);
    selection.exclude = selection.exclude.includes(value)
      ? selection.exclude.filter((other) => other !== value)
      : [...selection.exclude, value];
    settle(draft, key);
  });
}

// Shows only this value, as selecting a result's journal or publisher does (spec 002 AC18b).
export function onlyValue(query: Query, key: FilterKey, value: string): Query {
  return changed(query, (draft) => {
    draft.filters[key] = { include: [value], exclude: [], match: 'any' };
  });
}

export function setMatch(query: Query, key: FilterKey, match: Match): Query {
  return changed(query, (draft) => {
    draft.filters[key].match = match;
    settle(draft, key);
  });
}

export function clearFilter(query: Query, key: FilterKey): Query {
  return changed(query, (draft) => {
    draft.filters[key] = emptySelection();
  });
}

export function setYears(query: Query, which: 'noticeYears' | 'paperYears', range: YearRange): Query {
  return changed(query, (draft) => {
    const { from, to } = range;
    draft[which] = from !== null && to !== null && from > to ? { from: to, to: from } : { from, to };
  });
}

export function setRevisions(query: Query, revisions: Query['revisions']): Query {
  return changed(query, (draft) => {
    draft.revisions = revisions;
  });
}

export function setEditorialStaff(query: Query, editorialStaff: Query['editorialStaff']): Query {
  return changed(query, (draft) => {
    draft.editorialStaff = editorialStaff;
  });
}

export function addAuthorName(query: Query, name: string): Query {
  return changed(query, (draft) => {
    if (!draft.authorNames.includes(name)) {
      draft.authorNames.push(name);
    }
  });
}

// Where a value stands in a filter.
export function valueState(query: Query, key: FilterKey, value: string): 'none' | 'include' | 'exclude' {
  const selection = query.filters[key];
  return selection.include.includes(value) ? 'include' : selection.exclude.includes(value) ? 'exclude' : 'none';
}
