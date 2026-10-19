// Links every page uses (spec 002 AC25).
import { parseQuery, queryHref } from './query/url';

// Retraction Watch's user guide: what the database is, and how to tell
// Retraction Watch about a missing retraction.
export const RW_USER_GUIDE = 'https://retractionwatch.com/retraction-watch-database-user-guide/';
// Retraction Watch's blog, which the header's database name links to.
export const RW_BLOG = 'https://retractionwatch.com/';
// Where Crossref distributes the data.
export const DATA_SOURCE = 'https://gitlab.com/crossref/retraction-watch-data';
// Crossref's page on the data, which the header's data date links to: Crossref
// acquired the database in 2023, and Retraction Watch updates it every working
// day (checked 2026-10-19).
export const CROSSREF_RW_DATA = 'https://www.crossref.org/documentation/retrieve-metadata/retraction-watch/';
// Retraction Watch's note on how it built the database (checked 2026-10-14).
export const RW_METHODOLOGY = 'https://retractionwatch.com/wp-content/uploads/2023/12/Building-The-Database.pdf';
// Crossref's metadata page, whose license table lists the Retraction Watch
// database under CC0 (page updated 2025-10-16, checked 2026-10-14).
export const CROSSREF_LICENSES = 'https://www.crossref.org/documentation/retrieve-metadata/';
// This site's code. The links only work for others once the repository is public.
export const REPOSITORY = 'https://github.com/janeszelag/retraction-search';
// What the cleaning changes, and why.
export const DATA_ISSUES = `${REPOSITORY}/blob/main/docs/data-issues.md`;
// Problems with this site, kept apart from problems with the data.
export const NEW_ISSUE = `${REPOSITORY}/issues/new`;

// A new GitHub issue with the page's link and the data date filled in, through
// GitHub's title and body URL parameters.
export function issueUrl({
  title,
  context,
  dataDate,
}: {
  title: string;
  // For example "Search link: https://…" or "Record: 7962".
  context?: string;
  // As the header reads it, such as "October 9, 2026".
  dataDate?: string;
}): string {
  const lines = [
    ...(context ? [context] : []),
    ...(dataDate ? [`Data as of: ${dataDate}`] : []),
    '',
    'What happened:',
    '',
    'What I expected:',
    '',
  ];
  return `${NEW_ISSUE}?${new URLSearchParams({ title, body: lines.join('\n') })}`;
}

// The issue for the page a visitor is on, as the prototype words it: the
// search's link on the search page, and the page's link anywhere else.
export function pageIssueUrl({ origin, pathname, search, dataDate }: { origin: string; pathname: string; search: string; dataDate?: string }): string {
  if (pathname === '/') {
    // The query as the site writes it, without parameters it doesn't use.
    return issueUrl({ title: 'Problem with the search', context: `Search link: ${origin}${queryHref(parseQuery(new URLSearchParams(search)))}`, dataDate });
  }
  if (/^\/record\/\d+$/.test(pathname)) {
    return issueUrl({ title: 'Problem with a record page', context: `Record page: ${origin}${pathname}`, dataDate });
  }
  return issueUrl({ title: 'Problem with this site', context: `Page: ${origin}${pathname}`, dataDate });
}
