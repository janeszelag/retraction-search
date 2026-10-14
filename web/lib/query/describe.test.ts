import { describe, expect, it } from 'vitest';
import { citation, describeQuery, joinList, totalPhrase } from './describe';
import { identifierLookup } from './identifier';
import { defaultQuery } from './types';
import { parseQuery, serializeQuery } from './url';

const parse = (search: string) => parseQuery(new URLSearchParams(search));
const sentence = (search: string) => describeQuery(parse(search)).sentence;
const texts = (search: string) => describeQuery(parse(search)).parts.map((part) => part.text);
// The URL a summary part's remove link goes to.
const removing = (search: string, text: string) => {
  const part = describeQuery(parse(search)).parts.find((candidate) => candidate.text === text);
  if (!part) {
    throw new Error(`no part "${text}" in ${texts(search).join(' | ')}`);
  }
  return part.remove === null ? null : serializeQuery(part.remove);
};

describe('summary sentence (AC15)', () => {
  it("reads the spec's example", () => {
    expect(
      sentence(
        'reason=Manipulation+of+Images&reason=Duplication+of%2Fin+Image&subject=BLS%3A+Neuroscience&notice_from=2015',
      ),
    ).toBe(
      "Retractions, excluding revised versions, where Retraction Watch's reasons include Manipulation of Images or Duplication of/in Image, in the subject Neuroscience (BLS), with notices from 2015 on.",
    );
  });

  it('states both defaults (AC2)', () => {
    expect(sentence('')).toBe('Retractions, excluding revised versions.');
  });

  it('describes notice types and the two options', () => {
    expect(texts('type=all')[0]).toBe('All notice types');
    expect(texts('type=Retraction&type=Expression+of+concern')[0]).toBe('Retractions and expressions of concern');
    expect(texts('not_type=Correction&not_type=Reinstatement')[0]).toBe('All notice types except corrections and reinstatements');
    expect(texts('revisions=include')).toContain('including revised versions');
    expect(texts('editorial_staff=exclude')).toContain('excluding notices with editorial staff as the author');
  });

  it('describes every filter, included and excluded', () => {
    const parts = texts(
      [
        'reason=A&reason=B&reason_match=all&not_reason=C',
        'subject=BLS&subject=HSC%3A+Medicine+-+Oncology&not_subject=BLS%3A+Neuroscience',
        'country=China&country=India&not_country=Unknown',
        'publisher=Elsevier&not_publisher=Springer',
        'journal=medRxiv&not_journal=Cureus',
        'article_type=Research+Article&not_article_type=Review+Article',
        'paywalled=Yes&not_paywalled=Unknown',
        'notice_from=2015&notice_to=2020&paper_to=1969',
      ].join('&'),
    );
    expect(parts).toEqual([
      'Retractions',
      'excluding revised versions',
      "where Retraction Watch's reasons include A and B",
      "where Retraction Watch's reasons don't include C",
      'in Basic Life Sciences (BLS) or the subject Medicine - Oncology (HSC)',
      'outside the subject Neuroscience (BLS)',
      'with an author listed in China or India',
      'with no author listed in Unknown',
      'published by Elsevier',
      'not published by Springer',
      'in the journal medRxiv',
      'not in the journal Cureus',
      'with the article type Research Article',
      'excluding the article type Review Article',
      'with a paywalled notice',
      'excluding unknown paywall status',
      'with notices from 2015 to 2020',
      'for papers published up to 1969',
    ]);
  });

  it('describes a single year', () => {
    expect(texts('paper_from=2001&paper_to=2001')).toContain('for papers published in 2001');
  });

  it('describes search text, field terms (AC11) and author names (AC14)', () => {
    const parts = texts(
      'q=heart&in_institution=University+of+Toronto&in_institution=Medical&in_institution_match=all&not_in_title=mouse+model&author_name=Maria+Example',
    );
    expect(parts).toEqual([
      'Retractions',
      'excluding revised versions',
      'matching “heart”',
      'with no title containing the words “mouse model”',
      'with an institution containing the words “University of Toronto” and “Medical”',
      'listing the author name “Maria Example”',
    ]);
  });

  it('never describes author matches as one person’s work', () => {
    const text = sentence('author_name=Maria+Example&author_name=Jun+Sample');
    expect(text).toContain('listing the author name “Maria Example”, listing the author name “Jun Sample”');
    expect(text).not.toMatch(/\bby\b|papers of|work of/);
  });
});

describe('identifier lookups (AC12)', () => {
  it('says the filters are ignored', () => {
    const summary = describeQuery(parse('q=https%3A%2F%2Fdoi.org%2F10.1002%2FJCB.23190&reason=A&type=all'));
    expect(summary.sentence).toBe(
      'Records whose notice or paper has the DOI 10.1002/jcb.23190, with filters ignored, as for every identifier lookup.',
    );
    expect(summary.parts[1].remove).toBeNull();
  });

  it('recognizes DOIs and PubMed IDs in the forms people paste', () => {
    expect(identifierLookup('10.1002/jcb.23190')).toEqual({ kind: 'doi', value: '10.1002/jcb.23190' });
    expect(identifierLookup(' DOI: 10.1002/JCB.23190 ')).toEqual({ kind: 'doi', value: '10.1002/jcb.23190' });
    expect(identifierLookup('http://dx.doi.org/10.1002/jcb.23190')).toEqual({ kind: 'doi', value: '10.1002/jcb.23190' });
    expect(identifierLookup('10.1002%2Fjcb.23190')).toEqual({ kind: 'doi', value: '10.1002/jcb.23190' });
    expect(identifierLookup('21598307')).toEqual({ kind: 'pubmed', value: 21598307 });
    expect(identifierLookup('PMID: 21598307')).toEqual({ kind: 'pubmed', value: 21598307 });
    expect(identifierLookup('https://pubmed.ncbi.nlm.nih.gov/21598307/')).toEqual({ kind: 'pubmed', value: 21598307 });
    for (const text of ['2015', 'cancer', '10.1002', 'retraction 21598307', '']) {
      expect(identifierLookup(text), text).toBeNull();
    }
  });
});

describe('removing a part (AC15)', () => {
  const search = 'q=heart&reason=A&not_reason=B&author_name=Maria+Example&notice_from=2015&page=4';

  it('gives the query without that part, back on the first page', () => {
    expect(removing(search, 'matching “heart”')).toBe('author_name=Maria+Example&reason=A&not_reason=B&notice_from=2015');
    expect(removing(search, "where Retraction Watch's reasons include A")).toBe(
      'q=heart&author_name=Maria+Example&not_reason=B&notice_from=2015',
    );
    expect(removing(search, 'listing the author name “Maria Example”')).toBe('q=heart&reason=A&not_reason=B&notice_from=2015');
    expect(removing(search, 'with notices from 2015 on')).toBe('q=heart&author_name=Maria+Example&reason=A&not_reason=B');
  });

  it('turns the defaults off, and back on', () => {
    expect(removing('', 'Retractions')).toBe('type=all');
    expect(removing('', 'excluding revised versions')).toBe('revisions=include');
    expect(removing('revisions=include', 'including revised versions')).toBe('');
    expect(removing('type=all', 'All notice types')).toBeNull();
  });

  it('removes all-of matching with the included values', () => {
    expect(removing('reason=A&reason=B&reason_match=all', "where Retraction Watch's reasons include A and B")).toBe('');
  });
});

describe('totals (AC17)', () => {
  it('counts by notice type', () => {
    expect(totalPhrase({ Retraction: 1234 })).toBe('1,234 retractions');
    expect(totalPhrase({ Retraction: 1200, 'Expression of concern': 34 })).toBe('1,200 retractions and 34 expressions of concern');
    expect(totalPhrase({ Reinstatement: 1, Retraction: 1, Correction: 2, 'Expression of concern': 1 })).toBe(
      '1 retraction, 1 expression of concern, 2 corrections and 1 reinstatement',
    );
  });

  it('says when nothing matches', () => {
    expect(totalPhrase({})).toBe('No matching records');
    expect(totalPhrase({ Retraction: 0 })).toBe('No matching records');
  });

  it('lists a notice type it does not know after the known ones', () => {
    expect(totalPhrase({ Retraction: 2, Erratum: 3 })).toBe('2 retractions and 3 erratum');
  });
});

describe('citation (AC24)', () => {
  it('gives the count, the summary, the data date, the URL and both ISSNs', () => {
    const query = parse('reason=Manipulation+of+Images&notice_from=2015');
    const url = `https://example.org/?${serializeQuery(query)}`;
    expect(citation({ query, totals: { Retraction: 874 }, dataDate: '2026-10-09', url })).toBe(
      "874 retractions. Retractions, excluding revised versions, where Retraction Watch's reasons include Manipulation of Images, with notices from 2015 on. " +
        'Source: Retraction Watch Database (ISSN 2692-4579), data as of October 9, 2026; Retraction Watch blog (ISSN 2692-465X). ' +
        'Searched at https://example.org/?reason=Manipulation+of+Images&notice_from=2015',
    );
  });

  it('counts mixed notice types separately', () => {
    const line = citation({
      query: defaultQuery(),
      totals: { Retraction: 10, Correction: 2 },
      dataDate: '2026-10-09',
      url: 'https://example.org/',
    });
    expect(line.startsWith('10 retractions and 2 corrections. ')).toBe(true);
  });
});

describe('joinList', () => {
  it('joins with commas and a final conjunction', () => {
    expect(joinList([], 'or')).toBe('');
    expect(joinList(['A'], 'or')).toBe('A');
    expect(joinList(['A', 'B'], 'and')).toBe('A and B');
    expect(joinList(['A', 'B', 'C'], 'or')).toBe('A, B or C');
  });
});
