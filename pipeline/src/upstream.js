// The upstream repository: Crossref's copy of the Retraction Watch CSV on GitLab.
// Finds commits and checks that the newest one is recent (spec 003, AC11).
// Every function takes an optional `fetch`, so tests can answer for GitLab.
export const SOURCE = 'https://gitlab.com/crossref/retraction-watch-data';
const PROJECT_API = 'https://gitlab.com/api/v4/projects/crossref%2Fretraction-watch-data';
export const FILE_NAME = 'retraction_watch.csv';

export function rawFileUrl(commitSha) {
  return `${SOURCE}/-/raw/${commitSha}/${FILE_NAME}`;
}

// Upstream commit titles read "Retraction Watch data for 2026-10-09".
export function dataDateFromCommit(commit) {
  const match = /\d{4}-\d{2}-\d{2}/.exec(commit.title ?? '');
  return match ? match[0] : commit.committed_date.slice(0, 10);
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`GitLab returned ${response.status} for ${url}`);
  }
  return response.json();
}

// The commit with the given SHA, or without one, the newest commit on main
// that changed the CSV.
export async function findCommit(requestedSha, { fetch: fetchImpl = globalThis.fetch } = {}) {
  if (requestedSha) {
    return fetchJson(fetchImpl, `${PROJECT_API}/repository/commits/${encodeURIComponent(requestedSha)}`);
  }
  const commits = await fetchJson(fetchImpl, `${PROJECT_API}/repository/commits?ref_name=main&path=${FILE_NAME}&per_page=1`);
  if (commits.length === 0) {
    throw new Error(`GitLab returned no commits for ${FILE_NAME}`);
  }
  return commits[0];
}

// GitLab reports the file's git blob ID and SHA-256 in the headers of this
// request. The blob ID is of the stored bytes. The SHA-256 is of a copy
// converted to UTF-8, so it differs for a file that isn't UTF-8 (spec 003, AC22).
export async function findUpstreamChecksums(commitSha, { fetch: fetchImpl = globalThis.fetch } = {}) {
  const url = `${PROJECT_API}/repository/files/${FILE_NAME}?ref=${commitSha}`;
  const response = await fetchImpl(url, { method: 'HEAD' });
  if (!response.ok) {
    throw new Error(`GitLab returned ${response.status} for ${url}`);
  }
  return {
    blobId: response.headers.get('x-gitlab-blob-id'),
    sha256: response.headers.get('x-gitlab-content-sha256'),
  };
}

// Upstream commits once each working day, at about 23:00 UTC. Over the 40
// commits up to 2026-10-14, the longest gap was one missed working day.
export const MAX_WORKING_DAYS_OLD = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

// Working days (Monday to Friday, in UTC, with no holiday calendar) after
// the day of `from`, up to and including the day of `to`.
export function workingDaysBetween(from, to) {
  const dayOf = (date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  let count = 0;
  for (let day = dayOf(from) + DAY_MS; day <= dayOf(to); day += DAY_MS) {
    const weekday = new Date(day).getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      count += 1;
    }
  }
  return count;
}

export class StaleUpstreamError extends Error {}

// Fails when the newest commit is more than three working days old, because
// the file may have moved or stopped updating (AC11). Returns its age.
export function checkFreshness(commit, now = new Date()) {
  const age = workingDaysBetween(new Date(commit.committed_date), now);
  if (age > MAX_WORKING_DAYS_OLD) {
    throw new StaleUpstreamError(
      `Upstream's newest snapshot (commit ${commit.short_id}, ${commit.committed_date}) is ${age} working days old, more than the limit of ${MAX_WORKING_DAYS_OLD}. The file may have moved or stopped updating: check ${SOURCE}.`,
    );
  }
  return age;
}
