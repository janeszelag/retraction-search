import { describe, expect, it } from 'vitest';
import { issueUrl } from './links';

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
