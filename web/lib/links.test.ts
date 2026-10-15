import { describe, expect, it } from 'vitest';
import { issueUrl, pageIssueUrl } from './links';

describe('issue links (AC25)', () => {
  it('fills in the page and the data date', () => {
    const url = new URL(
      issueUrl({ title: 'Problem with the search', context: 'Search link: https://example.org/?q=heart', dataDate: 'October 9, 2026' }),
    );
    expect(url.origin + url.pathname).toBe('https://github.com/janeszelag/retraction-search/issues/new');
    expect(url.searchParams.get('title')).toBe('Problem with the search');
    expect(url.searchParams.get('body')).toBe(
      'Search link: https://example.org/?q=heart\nData as of: October 9, 2026\n\nWhat happened:\n\nWhat I expected:\n',
    );
  });

  it('works without a page or date', () => {
    expect(new URL(issueUrl({ title: 'Problem with this site' })).searchParams.get('body')).toBe(
      '\nWhat happened:\n\nWhat I expected:\n',
    );
  });
});

describe('the footer’s issue link for each page (AC25)', () => {
  const issue = (pathname: string, search = '') => {
    const url = new URL(pageIssueUrl({ origin: 'https://example.org', pathname, search, dataDate: 'October 9, 2026' }));
    return { title: url.searchParams.get('title'), body: url.searchParams.get('body')?.split('\n').slice(0, 2) };
  };

  it('gives the search page’s link, written the way the site writes queries', () => {
    expect(issue('/', 'reason=Manipulation+of+Images&q=heart&utm_source=mail')).toEqual({
      title: 'Problem with the search',
      body: ['Search link: https://example.org/?q=heart&reason=Manipulation+of+Images', 'Data as of: October 9, 2026'],
    });
    expect(issue('/').body?.[0]).toBe('Search link: https://example.org/');
  });

  it('gives a record page’s link', () => {
    expect(issue('/record/7962')).toEqual({
      title: 'Problem with a record page',
      body: ['Record page: https://example.org/record/7962', 'Data as of: October 9, 2026'],
    });
  });

  it('gives any other page’s link', () => {
    expect(issue('/about')).toEqual({ title: 'Problem with this site', body: ['Page: https://example.org/about', 'Data as of: October 9, 2026'] });
  });
});
