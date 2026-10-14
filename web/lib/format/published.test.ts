import { describe, expect, it } from 'vitest';
import type { ResultRecord } from '../search/types';
import { publishedRows } from './published';

function record(overrides: Partial<ResultRecord>): ResultRecord {
  return {
    recordId: 1,
    title: 'Synthetic record',
    titleSegments: [],
    authors: ['Maria Example'],
    authorSegments: [],
    matchedAuthors: [],
    institutions: ['Unknown'],
    journal: 'Synthetic Journal of Examples',
    publisher: 'Example Press',
    countries: ['Unknown'],
    subjects: [],
    subjectCategories: [],
    articleTypes: [],
    reasons: [],
    noticeType: 'Retraction',
    paywalled: 'No',
    isRevision: false,
    hasEditorialStaffAuthor: false,
    noticeDate: Date.UTC(2012, 2, 15) / 1000,
    noticeYear: 2012,
    paperDate: Date.UTC(2011, 4, 19) / 1000,
    paperYear: 2011,
    noticeDoi: '10.1002/jcb.23190',
    paperDoi: null,
    noticePubmedId: 21598307,
    paperPubmedId: null,
    urls: [],
    urlRecordCounts: [],
    notes: null,
    original: {},
    ...overrides,
  };
}

describe('published values (AC22)', () => {
  it('always shows the dates as published', () => {
    const rows = publishedRows(record({ original: { notice_date: '3/15/2012 0:00', paper_date: '5/19/2011 0:00' } }));
    expect(rows).toEqual([
      { field: 'RetractionDate', published: '3/15/2012 0:00', shown: 'March 15, 2012' },
      { field: 'OriginalPaperDate', published: '5/19/2011 0:00', shown: 'May 19, 2011' },
    ]);
  });

  it('shows identifiers only where the cleaning changed them', () => {
    const rows = publishedRows(
      record({
        original: { notice_doi: '10.1002/jcb.23190', paper_doi: 'unavailable', notice_pubmed_id: '21598307', paper_pubmed_id: '0' },
      }),
    );
    expect(rows).toEqual([
      { field: 'OriginalPaperDOI', published: 'unavailable', shown: 'None' },
      { field: 'OriginalPaperPubMedID', published: '0', shown: 'None' },
    ]);
  });

  it('shows rewritten names, placeholders and merged spellings', () => {
    const rows = publishedRows(
      record({ original: { author: 'Maria O`Example', institution: 'unavailable', journal: 'Synthetic journal of examples' } }),
    );
    expect(rows).toEqual([
      { field: 'Author', published: 'Maria O`Example', shown: 'Maria Example' },
      { field: 'Institution', published: 'unavailable', shown: 'Unknown' },
      { field: 'Journal', published: 'Synthetic journal of examples', shown: 'Synthetic Journal of Examples' },
    ]);
  });

  it('marks a blank published value', () => {
    expect(publishedRows(record({ original: { institution: '' } }))).toEqual([{ field: 'Institution', published: '(blank)', shown: 'Unknown' }]);
  });
});
