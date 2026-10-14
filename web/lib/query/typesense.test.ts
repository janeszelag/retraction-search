import { describe, expect, it } from 'vitest';
import { LONG_FACET_LIMIT, PER_PAGE, SMALL_FACET_LIMIT, toTypesense, type SearchPlan } from './typesense';
import { parseQuery } from './url';

const plan = (search: string, options?: Parameters<typeof toTypesense>[1]) =>
  toTypesense(parseQuery(new URLSearchParams(search)), options);

const DEFAULTS = 'notice_type:=[`Retraction`] && is_revision:=false';

function main(result: SearchPlan) {
  expect(result.roles[0].kind).toBe('results');
  return result.searches[0];
}

// The counts search for one part of the filter.
function counts(result: SearchPlan, part: string | null) {
  const index = result.roles.findIndex((role) => role.kind === 'counts' && role.part === part);
  expect(index, `counts for ${part}`).toBeGreaterThan(-1);
  return result.searches[index];
}

const hasCounts = (result: SearchPlan, part: string) =>
  result.roles.some((role) => role.kind === 'counts' && role.part === part);

describe('the default view (AC1, AC2)', () => {
  const result = plan('');

  it('filters to retractions without revised versions, newest first', () => {
    expect(main(result)).toMatchObject({
      collection: 'retractions',
      q: '*',
      filter_by: DEFAULTS,
      sort_by: 'notice_date:desc,record_id:desc',
      per_page: PER_PAGE,
      page: 1,
    });
  });

  it('counts every small filter in the main search, and notice types for the total', () => {
    expect(main(result).facet_by).toBe(
      'notice_type,reasons,subjects,subject_categories,countries,article_types,paywalled,notice_year,paper_year,has_editorial_staff_author',
    );
    expect(main(result).max_facet_values).toBe(SMALL_FACET_LIMIT);
  });

  it('counts the other notice types and the revised versions without their own setting (AC2, AC4)', () => {
    expect(counts(result, 'type')).toMatchObject({ filter_by: 'is_revision:=false', facet_by: 'notice_type', per_page: 0 });
    expect(counts(result, 'revisions')).toMatchObject({
      filter_by: 'notice_type:=[`Retraction`]',
      facet_by: 'is_revision',
      per_page: 0,
    });
  });

  it('counts the top journals and publishers in a search of their own', () => {
    expect(counts(result, null)).toMatchObject({
      filter_by: DEFAULTS,
      facet_by: 'journal,publisher',
      max_facet_values: LONG_FACET_LIMIT,
      per_page: 0,
    });
    expect(result.searches).toHaveLength(4);
  });
});

describe('filters (AC4, AC5)', () => {
  it('matches any of several values, and counts that filter without its own clause', () => {
    const result = plan('reason=A&reason=B');
    expect(main(result).filter_by).toBe(`${DEFAULTS} && reasons:=[\`A\`, \`B\`]`);
    expect(main(result).facet_by).not.toContain('reasons');
    expect(counts(result, 'reason')).toMatchObject({ filter_by: DEFAULTS, facet_by: 'reasons' });
  });

  it('matches all of several values, and counts that filter with its own clause', () => {
    const result = plan('reason=A&reason=B&reason_match=all');
    expect(main(result).filter_by).toBe(`${DEFAULTS} && reasons:=\`A\` && reasons:=\`B\``);
    expect(main(result).facet_by).toContain('reasons');
    expect(hasCounts(result, 'reason')).toBe(false);
  });

  it('excludes values, and still counts the excluded ones', () => {
    const result = plan('not_country=China&not_country=India');
    expect(main(result).filter_by).toBe(`${DEFAULTS} && countries:!=[\`China\`, \`India\`]`);
    expect(counts(result, 'country').filter_by).toBe(DEFAULTS);
  });

  it('combines included and excluded values of one filter', () => {
    expect(main(plan('reason=A&not_reason=C')).filter_by).toBe(`${DEFAULTS} && reasons:=[\`A\`] && reasons:!=[\`C\`]`);
  });

  it('selects every notice type with type=all, and counts types in the main search', () => {
    const result = plan('type=all');
    expect(main(result).filter_by).toBe('is_revision:=false');
    expect(hasCounts(result, 'type')).toBe(false);
  });

  it('writes notice-type exclusions', () => {
    expect(main(plan('not_type=Correction')).filter_by).toBe('notice_type:!=[`Correction`] && is_revision:=false');
  });

  it('keeps commas, parentheses and slashes inside backtick literals', () => {
    const journal = '2010 International Conference on Optics, Photonics and Energy Engineering (OPEE)';
    const result = plan(`journal=${encodeURIComponent(journal)}&reason=${encodeURIComponent('Duplication of/in Image')}`);
    expect(main(result).filter_by).toBe(
      `${DEFAULTS} && reasons:=[\`Duplication of/in Image\`] && journal:=[\`${journal}\`]`,
    );
  });

  it('drops a backtick, which no value in the data holds', () => {
    expect(main(plan('reason=A%60%20%7C%7C%20id%3A*')).filter_by).toBe(`${DEFAULTS} && reasons:=[\`A || id:*\`]`);
  });

  it('matches subject categories and subjects in their own fields', () => {
    const subject = (search: string) => main(plan(search)).filter_by!.replace(`${DEFAULTS} && `, '');
    expect(subject('subject=BLS&subject=HSC%3A+Medicine+-+Oncology')).toBe(
      '(subject_categories:=[`BLS`] || subjects:=[`HSC: Medicine - Oncology`])',
    );
    expect(subject('subject=BLS&subject=HSC%3A+Medicine+-+Oncology&subject_match=all')).toBe(
      'subject_categories:=`BLS` && subjects:=`HSC: Medicine - Oncology`',
    );
    expect(subject('subject=BLS%3A+Neuroscience')).toBe('subjects:=[`BLS: Neuroscience`]');
    expect(subject('not_subject=HUM&not_subject=BLS%3A+Neuroscience')).toBe(
      'subject_categories:!=[`HUM`] && subjects:!=[`BLS: Neuroscience`]',
    );
  });

  it('counts subjects and categories together, without the subject clause', () => {
    expect(counts(plan('subject=BLS'), 'subject')).toMatchObject({ filter_by: DEFAULTS, facet_by: 'subjects,subject_categories' });
  });
});

describe('long filters (AC6)', () => {
  it('counts the top values without the filter, and the selected values on their own', () => {
    const result = plan('journal=medRxiv&journal=Cureus&not_journal=Nature');
    expect(counts(result, 'journal')).toMatchObject({ filter_by: DEFAULTS, facet_by: 'journal', max_facet_values: LONG_FACET_LIMIT });
    const index = result.roles.findIndex((role) => role.kind === 'selected' && role.part === 'journal');
    expect(result.searches[index]).toMatchObject({
      filter_by: `${DEFAULTS} && journal:=[\`medRxiv\`, \`Cureus\`, \`Nature\`]`,
      facet_by: 'journal',
      max_facet_values: 3,
      per_page: 0,
    });
    // Publishers have no selection, so they're counted with the main filter.
    expect(counts(result, null).facet_by).toBe('publisher');
  });
});

describe('years and options (AC3, AC8)', () => {
  it('filters a year range and counts years without it', () => {
    const result = plan('notice_from=2015&notice_to=2020&paper_to=1969');
    expect(main(result).filter_by).toBe(
      `${DEFAULTS} && notice_year:>=2015 && notice_year:<=2020 && paper_year:<=1969`,
    );
    expect(counts(result, 'notice_years')).toMatchObject({
      filter_by: `${DEFAULTS} && paper_year:<=1969`,
      facet_by: 'notice_year',
    });
    expect(counts(result, 'paper_years').filter_by).toBe(`${DEFAULTS} && notice_year:>=2015 && notice_year:<=2020`);
  });

  it('includes revised versions and excludes editorial-staff notices', () => {
    const result = plan('revisions=include&editorial_staff=exclude');
    expect(main(result).filter_by).toBe('notice_type:=[`Retraction`] && has_editorial_staff_author:=false');
    expect(hasCounts(result, 'revisions')).toBe(false);
    expect(counts(result, 'editorial_staff')).toMatchObject({
      filter_by: 'notice_type:=[`Retraction`]',
      facet_by: 'has_editorial_staff_author',
    });
  });
});

describe('field terms (AC11)', () => {
  it('matches all the words of a term anywhere in its field', () => {
    expect(main(plan('in_institution=University+of+Toronto')).filter_by).toBe(
      `${DEFAULTS} && institutions:\`University of Toronto\``,
    );
  });

  it('matches any or all of one field’s terms, and every field', () => {
    expect(main(plan('in_title=mouse&in_title=rat+model&in_author=Example')).filter_by).toBe(
      `${DEFAULTS} && (title:\`mouse\` || title:\`rat model\`) && authors:\`Example\``,
    );
    expect(main(plan('in_title=mouse&in_title=rat+model&in_title_match=all')).filter_by).toBe(
      `${DEFAULTS} && title:\`mouse\` && title:\`rat model\``,
    );
  });

  it('excludes a term by keeping records that miss any of its words', () => {
    expect(main(plan('not_in_institution=University+of+Toronto&not_in_title=mouse')).filter_by).toBe(
      `${DEFAULTS} && title:!\`mouse\` && (institutions:!\`University\` || institutions:!\`of\` || institutions:!\`Toronto\`)`,
    );
  });

  it('keeps field terms in every counts search', () => {
    const result = plan('in_title=mouse&reason=A');
    expect(counts(result, 'reason').filter_by).toBe(`${DEFAULTS} && title:\`mouse\``);
  });
});

describe('author names (AC14)', () => {
  it('requires each selected name to be listed', () => {
    expect(main(plan('author_name=Maria+Example&author_name=Jun+Sample')).filter_by).toBe(
      `${DEFAULTS} && authors:=\`Maria Example\` && authors:=\`Jun Sample\``,
    );
  });

  it('keeps an apostrophe, which the cleaning uses in place of a backtick', () => {
    expect(main(plan("author_name=Maria+O'Example")).filter_by).toContain("authors:=`Maria O'Example`");
  });
});

describe('identifier lookups (AC12)', () => {
  it('looks up a DOI in the notice and the paper, ignoring every other part', () => {
    const result = plan('q=https%3A%2F%2Fdoi.org%2F10.1002%2FJCB.23190&reason=A&type=all&in_title=mouse&page=3');
    expect(result.lookup).toEqual({ kind: 'doi', value: '10.1002/jcb.23190' });
    expect(result.searches).toHaveLength(1);
    expect(main(result)).toMatchObject({
      q: '*',
      filter_by: 'notice_doi:=`10.1002/jcb.23190` || paper_doi:=`10.1002/jcb.23190`',
      facet_by: 'notice_type',
      page: 3,
    });
  });

  it('looks up a PubMed ID as a number', () => {
    expect(main(plan('q=21598307')).filter_by).toBe('notice_pubmed_id:=21598307 || paper_pubmed_id:=21598307');
  });
});

describe('search text (AC10, AC13)', () => {
  const result = plan('q=heart+failure&reason=A');

  it('searches five fields with the typo settings from spike S6, never dropping words', () => {
    for (const search of result.searches) {
      expect(search).toMatchObject({
        q: 'heart failure',
        query_by: 'title,authors,institutions,journal,publisher',
        drop_tokens_threshold: 0,
      });
    }
    expect(main(result).num_typos).toBe('2,1,1,2,1');
    expect(main(result).typo_tokens_threshold).toBeUndefined();
  });

  it('counts exact matches to tell when Typesense fell back to close spellings', () => {
    const index = result.roles.findIndex((role) => role.kind === 'exact');
    expect(result.searches[index]).toMatchObject({ num_typos: '0', filter_by: main(result).filter_by, per_page: 0 });
  });

  it('turns typos on for every search in the second form, without the exact count', () => {
    const always = plan('q=heart+failure&reason=A', { typos: 'always' });
    expect(always.roles.some((role) => role.kind === 'exact')).toBe(false);
    for (const search of always.searches) {
      expect(search.typo_tokens_threshold).toBe(1_000_000);
    }
  });

  it('marks matched words in titles and author names without HTML', () => {
    expect(main(result)).toMatchObject({
      highlight_fields: 'title,authors',
      highlight_full_fields: 'title,authors',
      highlight_start_tag: '',
      highlight_end_tag: '',
    });
  });

  it('has no exact count without search text', () => {
    expect(plan('reason=A').roles.some((role) => role.kind === 'exact')).toBe(false);
  });
});

describe('sorting and paging (AC19, AC20)', () => {
  it.each([
    ['q=heart', '_text_match:desc,notice_date:desc,record_id:desc'],
    ['', 'notice_date:desc,record_id:desc'],
    ['sort=oldest', 'notice_date:asc,record_id:asc'],
    ['sort=paper_newest', 'paper_date:desc,record_id:desc'],
    ['sort=paper_oldest', 'paper_date:asc,record_id:asc'],
    ['q=heart&sort=newest', 'notice_date:desc,record_id:desc'],
    ['sort=relevance', 'notice_date:desc,record_id:desc'],
  ])('sorts "%s" by %s', (search, sortBy) => {
    expect(main(plan(search)).sort_by).toBe(sortBy);
  });

  it('asks for the page in the URL', () => {
    expect(main(plan('page=3370'))).toMatchObject({ page: 3370, per_page: PER_PAGE });
  });
});

describe('size', () => {
  it('stays within Typesense’s 50 searches for a query that sets everything', () => {
    const everything = [
      'q=heart',
      'type=Retraction&type=Correction&not_type=Reinstatement',
      'reason=A&not_reason=B&subject=BLS&not_subject=HUM&country=China&not_country=India',
      'article_type=X&not_article_type=Y&paywalled=Yes&not_paywalled=Unknown',
      'journal=J1&journal=J2&not_journal=J3&publisher=P1&not_publisher=P2',
      'notice_from=2015&paper_to=2020&editorial_staff=exclude',
    ].join('&');
    const result = plan(everything);
    expect(result.searches.length).toBeLessThanOrEqual(50);
    expect(result.roles.filter((role) => role.kind === 'counts')).toHaveLength(12);
  });
});
