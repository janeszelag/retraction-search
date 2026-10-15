// A stand-in for GitLab's API and raw files, serving fixture CSVs as upstream
// commits. Pass its `fetch` wherever the pipeline takes one.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// commits: newest first, each { id, title, committed_date, file } with a full 40-character id.
export function fakeGitlab(commits) {
  const requests = [];
  const withShort = commits.map((commit) => ({ ...commit, short_id: commit.id.slice(0, 8) }));
  const find = (sha) => withShort.find((commit) => commit.id.startsWith(sha));
  const json = (value) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  const notFound = () => new Response('{"message":"404 Commit Not Found"}', { status: 404 });
  const describe = ({ file, ...commit }) => commit;

  async function fetch(input, init = {}) {
    const url = new URL(String(input));
    requests.push(`${init.method ?? 'GET'} ${url.pathname}${url.search}`);
    let match = /\/repository\/commits\/([^/]+)$/.exec(url.pathname);
    if (match) {
      const commit = find(decodeURIComponent(match[1]));
      return commit ? json(describe(commit)) : notFound();
    }
    if (url.pathname.endsWith('/repository/commits')) {
      return json(withShort.slice(0, 1).map(describe));
    }
    if (url.pathname.endsWith('/repository/files/retraction_watch.csv')) {
      const commit = find(url.searchParams.get('ref'));
      if (!commit) {
        return notFound();
      }
      const sha256 = createHash('sha256').update(readFileSync(commit.file)).digest('hex');
      return new Response(null, { headers: { 'x-gitlab-content-sha256': sha256 } });
    }
    match = /\/-\/raw\/([0-9a-f]+)\/retraction_watch\.csv$/.exec(url.pathname);
    if (match) {
      const commit = find(match[1]);
      return commit ? new Response(readFileSync(commit.file)) : notFound();
    }
    return notFound();
  }

  return { fetch, requests };
}
