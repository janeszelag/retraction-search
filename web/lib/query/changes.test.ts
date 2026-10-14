import { describe, expect, it } from 'vitest';
import {
  addAuthorName,
  clearFilter,
  onlyValue,
  setEditorialStaff,
  setMatch,
  setRevisions,
  setYears,
  toggleExclude,
  toggleInclude,
  valueState,
} from './changes';
import { parseQuery, serializeQuery } from './url';

const parse = (search: string) => parseQuery(new URLSearchParams(search));
const after = (search: string, change: (query: ReturnType<typeof parse>) => ReturnType<typeof parse>) =>
  serializeQuery(change(parse(search)));

describe('filter changes (AC5)', () => {
  it('includes a value, and stops including it', () => {
    expect(after('', (query) => toggleInclude(query, 'reason', 'A'))).toBe('reason=A');
    expect(after('reason=A&reason=B', (query) => toggleInclude(query, 'reason', 'A'))).toBe('reason=B');
  });

  it('moves a value between included and excluded', () => {
    expect(after('reason=A', (query) => toggleExclude(query, 'reason', 'A'))).toBe('not_reason=A');
    expect(after('not_reason=A', (query) => toggleInclude(query, 'reason', 'A'))).toBe('reason=A');
    expect(after('not_reason=A', (query) => toggleExclude(query, 'reason', 'A'))).toBe('');
  });

  it('turns every notice type on when the default retractions are deselected (AC2)', () => {
    expect(after('', (query) => toggleInclude(query, 'type', 'Retraction'))).toBe('type=all');
    expect(after('', (query) => toggleInclude(query, 'type', 'Correction'))).toBe('type=Retraction&type=Correction');
    expect(after('', (query) => toggleExclude(query, 'type', 'Correction'))).toBe('type=Retraction&not_type=Correction');
  });

  it('switches between any and all, and drops all when fewer than two values remain', () => {
    expect(after('reason=A&reason=B', (query) => setMatch(query, 'reason', 'all'))).toBe('reason=A&reason=B&reason_match=all');
    expect(after('reason=A&reason=B&reason_match=all', (query) => toggleInclude(query, 'reason', 'B'))).toBe('reason=A');
  });

  it('clears a filter and keeps the rest', () => {
    expect(after('reason=A&not_reason=B&country=China', (query) => clearFilter(query, 'reason'))).toBe('country=China');
  });

  it('shows only one journal', () => {
    expect(after('journal=A&not_journal=B', (query) => onlyValue(query, 'journal', 'C'))).toBe('journal=C');
  });

  it('starts again on the first page after every change', () => {
    expect(after('page=7', (query) => toggleInclude(query, 'reason', 'A'))).toBe('reason=A');
    expect(after('page=7', (query) => setRevisions(query, 'include'))).toBe('revisions=include');
  });

  it('sets years, the options and author names', () => {
    expect(after('', (query) => setYears(query, 'noticeYears', { from: 2020, to: 2015 }))).toBe('notice_from=2015&notice_to=2020');
    expect(after('notice_from=2015', (query) => setYears(query, 'noticeYears', { from: null, to: null }))).toBe('');
    expect(after('', (query) => setEditorialStaff(query, 'exclude'))).toBe('editorial_staff=exclude');
    expect(after('author_name=Maria+Example', (query) => addAuthorName(query, 'Maria Example'))).toBe('author_name=Maria+Example');
  });

  it('reports where a value stands', () => {
    const query = parse('reason=A&not_reason=B');
    expect([valueState(query, 'reason', 'A'), valueState(query, 'reason', 'B'), valueState(query, 'reason', 'C')]).toEqual([
      'include',
      'exclude',
      'none',
    ]);
  });
});
