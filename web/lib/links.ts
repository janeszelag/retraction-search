// Links every page uses (spec 002 AC25).

// Retraction Watch's user guide: what the database is, and how to tell
// Retraction Watch about a missing retraction.
export const RW_USER_GUIDE = 'https://retractionwatch.com/retraction-watch-database-user-guide/';
// Where Crossref distributes the data.
export const DATA_SOURCE = 'https://gitlab.com/crossref/retraction-watch-data';
// Problems with this site, kept apart from problems with the data. The link
// only works for others once the repository is public.
export const NEW_ISSUE = 'https://github.com/janeszelag/retraction-search/issues/new';

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
