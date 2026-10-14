import { describe, expect, it } from 'vitest';
import { EXPORT_FIELDS } from '../search/csv';
import { EXPORT_PER_PAGE, toExportPlan } from './export';
import { toTypesense } from './typesense';
import { parseQuery } from './url';

const query = (search: string) => parseQuery(new URLSearchParams(search));
const pageSearch = (search: string, options?: Parameters<typeof toTypesense>[1]) => toTypesense(query(search), options).searches[0];

describe('the download asks for the page’s records (AC23)', () => {
  it('exports the default view through the export endpoint, with the page’s filter', () => {
    const plan = toExportPlan(query(''));
    expect(plan.source).toEqual({ kind: 'export', filterBy: pageSearch('').filter_by });
    expect(plan.exact).toBeNull();
    expect(plan.count).toEqual({
      collection: 'retractions',
      q: '*',
      filter_by: pageSearch('').filter_by,
      sort_by: pageSearch('').sort_by,
      include_fields: EXPORT_FIELDS.join(','),
      per_page: 0,
      page: 1,
    });
  });

  it('exports filters, field terms and author names without search text', () => {
    const search = 'reason=Manipulation+of+Images&not_country=Japan&in_title=brain+tumor&author_name=Maria+Example&notice_from=2015';
    const plan = toExportPlan(query(search));
    expect(plan.source).toEqual({ kind: 'export', filterBy: pageSearch(search).filter_by });
    expect(plan.count.filter_by).toContain('reasons:=[`Manipulation of Images`]');
    expect(plan.count.filter_by).toContain('title:`brain tumor`');
    expect(plan.count.filter_by).toContain('authors:=`Maria Example`');
  });

  it('exports an identifier lookup by its filter, ignoring the other filters (AC12)', () => {
    const plan = toExportPlan(query('q=10.1002/jcb.23190&reason=Manipulation+of+Images'));
    expect(plan.source).toEqual({ kind: 'export', filterBy: 'notice_doi:=`10.1002/jcb.23190` || paper_doi:=`10.1002/jcb.23190`' });
    expect(plan.count.q).toBe('*');
  });

  it('pages through a text search 250 at a time, in the page’s order', () => {
    const search = 'q=neuron&sort=oldest&type=all';
    const plan = toExportPlan(query(search));
    const main = pageSearch(search);
    expect(plan.source.kind).toBe('pages');
    const page = plan.source.kind === 'pages' ? plan.source.page(3) : null;
    expect(page).toEqual({
      collection: 'retractions',
      q: 'neuron',
      query_by: main.query_by,
      num_typos: main.num_typos,
      drop_tokens_threshold: 0,
      filter_by: main.filter_by,
      sort_by: 'notice_date:asc,record_id:asc',
      include_fields: EXPORT_FIELDS.join(','),
      per_page: EXPORT_PER_PAGE,
      page: 3,
    });
    expect(plan.count).toEqual({ ...page, per_page: 0, page: 1 });
  });

  it('checks for close spellings with the page’s exact search, then pages with typos on for every search', () => {
    const search = 'q=nuerons';
    const exact = toTypesense(query(search)).searches.at(-1);
    expect(toExportPlan(query(search)).exact).toEqual(exact);
    const always = toExportPlan(query(search), { typos: 'always' });
    expect(always.exact).toBeNull();
    expect(always.count.typo_tokens_threshold).toBe(pageSearch(search, { typos: 'always' }).typo_tokens_threshold);
    expect(always.source.kind === 'pages' && always.source.page(1).typo_tokens_threshold).toBe(always.count.typo_tokens_threshold);
  });
});
