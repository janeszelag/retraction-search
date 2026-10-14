// Loads one cleaned snapshot into Typesense (spec 002, plan "Data in Typesense").
// Usage: npm run load [-- --input <folder>]  (default: the newest folder in data/clean)
import { createReadStream } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { fileExists } from './files.js';
import { cleanDir, relativeToRepo, repoRoot } from './paths.js';
import { typesenseClient } from './typesense.js';

export const ALIAS = 'retractions';
export const META_COLLECTION = 'meta';
export const SEARCH_KEY_DESCRIPTION = 'retraction-search: search only';
const BATCH_SIZE = 5000;
const envFile = path.join(repoRoot, '.env.local');

// Fields outside the schema are stored and returned but not indexed:
// urls, url_record_counts, notes and original (decision record 002).
export function collectionSchema(name) {
  const facet = (fieldName, type) => ({ name: fieldName, type, facet: true });
  return {
    name,
    fields: [
      // Searched by the search box and field terms.
      { name: 'title', type: 'string' },
      { name: 'authors', type: 'string[]' },
      { name: 'institutions', type: 'string[]' },
      // Searched, and filter counts.
      facet('journal', 'string'),
      facet('publisher', 'string'),
      // Exact name filters (spike S8): Typesense's exact filters ignore capitals and accents.
      { name: 'author_keys', type: 'string[]' },
      { name: 'journal_key', type: 'string' },
      { name: 'publisher_key', type: 'string' },
      // Filters.
      facet('notice_type', 'string'),
      facet('paywalled', 'string'),
      facet('reasons', 'string[]'),
      facet('subjects', 'string[]'),
      facet('subject_categories', 'string[]'),
      facet('countries', 'string[]'),
      facet('article_types', 'string[]'),
      facet('is_revision', 'bool'),
      facet('has_editorial_staff_author', 'bool'),
      facet('notice_year', 'int32'),
      facet('paper_year', 'int32'),
      // Sorting: Unix seconds, negative before 1970.
      { name: 'notice_date', type: 'int64' },
      { name: 'paper_date', type: 'int64' },
      // Exact lookups. Records can lack any of these.
      { name: 'notice_doi', type: 'string', optional: true },
      { name: 'paper_doi', type: 'string', optional: true },
      { name: 'notice_pubmed_id', type: 'int64', optional: true },
      { name: 'paper_pubmed_id', type: 'int64', optional: true },
      // Record pages.
      { name: 'record_id', type: 'int32' },
    ],
  };
}

// Pages read the data date from this one-document collection.
export const metaSchema = {
  name: META_COLLECTION,
  fields: [{ name: 'data_date', type: 'string' }],
};

// data/clean/2026-10-09-bc5648dd → { dataDate: '2026-10-09', commit: 'bc5648dd' }
export function describeSnapshotDir(snapshotDir) {
  const match = /^(\d{4}-\d{2}-\d{2})-([0-9a-f]{7,40})$/.exec(path.basename(snapshotDir));
  if (!match) {
    throw new Error(`${path.basename(snapshotDir)} isn't a cleaned snapshot folder (<data date>-<short sha>).`);
  }
  return { dataDate: match[1], commit: match[2] };
}

// Named after the snapshot and the load time, so loading the same snapshot
// again makes a fresh collection: retractions_2026-10-09_bc5648dd_20261013T223012Z
export function collectionName({ dataDate, commit }, loadedAt) {
  const stamp = loadedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `${ALIAS}_${dataDate}_${commit}_${stamp}`;
}

export class ImportError extends Error {}

// Typesense's import returns HTTP 200 even when documents fail, with one
// result line per document. Returns the number imported, or throws on the
// first failure.
export function readImportResults(responseText, expected) {
  const lines = responseText.split('\n').filter((line) => line.trim() !== '');
  lines.forEach((line, index) => {
    const result = JSON.parse(line);
    if (result.success !== true) {
      const id = result.id === undefined ? `line ${index + 1} of the batch` : `document ${result.id}`;
      throw new ImportError(`Import failed at ${id}: ${result.error ?? line}`);
    }
  });
  if (lines.length !== expected) {
    throw new ImportError(`Import returned ${lines.length} results for ${expected} documents.`);
  }
  return lines.length;
}

// Snapshot collections other than the new one and the one the alias pointed to before.
export function collectionsToDelete(names, { current, previous }) {
  return names.filter((name) => name.startsWith(`${ALIAS}_`) && name !== current && name !== previous).sort();
}

// Sets NAME=value in the text of an env file, replacing an existing line or adding one.
export function withEnvValue(text, name, value) {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  if (pattern.test(text)) {
    return text.replace(pattern, () => line);
  }
  return `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${line}\n`;
}

// The newest folder in data/clean. Folder names start with the data date, so the newest sorts last.
export async function findNewestCleanSnapshot() {
  const folders = (await readdir(cleanDir, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}-[0-9a-f]{7,40}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (folders.length === 0) {
    throw new Error(`No cleaned snapshots in ${relativeToRepo(cleanDir)}. Run npm run clean first.`);
  }
  return path.join(cleanDir, folders.at(-1));
}

async function* batchesOf(file, size) {
  let batch = [];
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === '') {
      continue;
    }
    batch.push(line);
    if (batch.length === size) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length > 0) {
    yield batch;
  }
}

async function importDocuments(request, name, documentsFile) {
  let imported = 0;
  for await (const batch of batchesOf(documentsFile, BATCH_SIZE)) {
    const response = await request('POST', `/collections/${encodeURIComponent(name)}/documents/import`, {
      query: { action: 'create', dirty_values: 'reject', return_id: true },
      body: batch.join('\n'),
      text: true,
    });
    imported += readImportResults(response, batch.length);
  }
  return imported;
}

async function previousAliasTarget(request) {
  try {
    return (await request('GET', `/aliases/${ALIAS}`)).collection_name;
  } catch (error) {
    if (error.status === 404) {
      return null;
    }
    throw error;
  }
}

async function writeMeta(request, meta) {
  try {
    await request('GET', `/collections/${META_COLLECTION}`);
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
    await request('POST', '/collections', { body: metaSchema });
  }
  await request('POST', `/collections/${META_COLLECTION}/documents`, {
    query: { action: 'upsert' },
    body: { id: 'current', ...meta },
  });
}

// The collections a search-only key may search: the alias, every snapshot
// collection (Typesense reads these as regular expressions) and meta.
export const SEARCH_KEY_COLLECTIONS = [ALIAS, `${ALIAS}_.*`, META_COLLECTION];

function isOurSearchKey(key) {
  return (
    key.description === SEARCH_KEY_DESCRIPTION &&
    JSON.stringify(key.actions) === JSON.stringify(['documents:search']) &&
    JSON.stringify(key.collections) === JSON.stringify(SEARCH_KEY_COLLECTIONS)
  );
}

// Reuses the search-only key in .env.local if Typesense still has it.
// Otherwise creates one, saves it to .env.local and deletes older ones.
async function ensureSearchKey(request, currentValue) {
  const { keys } = await request('GET', '/keys');
  const ours = keys.filter(isOurSearchKey);
  if (currentValue && ours.some((key) => currentValue.startsWith(key.value_prefix))) {
    return { created: false };
  }
  const created = await request('POST', '/keys', {
    body: { description: SEARCH_KEY_DESCRIPTION, actions: ['documents:search'], collections: SEARCH_KEY_COLLECTIONS },
  });
  const text = (await fileExists(envFile)) ? await readFile(envFile, 'utf8') : '';
  await writeFile(envFile, withEnvValue(text, 'TYPESENSE_SEARCH_KEY', created.value));
  for (const key of ours) {
    await request('DELETE', `/keys/${key.id}`);
  }
  return { created: true };
}

export async function runLoad({ snapshotDir, request, searchKey, log = console.log, now = new Date() }) {
  const snapshot = describeSnapshotDir(snapshotDir);
  const documentsFile = path.join(snapshotDir, 'search-documents.jsonl');
  const name = collectionName(snapshot, now);

  await request('POST', '/collections', { body: collectionSchema(name) });
  let documents;
  try {
    const imported = await importDocuments(request, name, documentsFile);
    documents = (await request('GET', `/collections/${encodeURIComponent(name)}`)).num_documents;
    if (documents !== imported) {
      throw new ImportError(`${name} holds ${documents} documents, but ${imported} were imported.`);
    }
  } catch (error) {
    await request('DELETE', `/collections/${encodeURIComponent(name)}`).catch(() => {});
    throw error;
  }
  log(`Imported ${documents} documents into ${name}.`);

  const previous = await previousAliasTarget(request);
  await request('PUT', `/aliases/${ALIAS}`, { body: { collection_name: name } });
  await writeMeta(request, {
    data_date: snapshot.dataDate,
    commit: snapshot.commit,
    collection: name,
    documents,
    loaded_at: now.toISOString(),
  });
  log(`Pointed the ${ALIAS} alias at ${name}${previous ? ` (it was ${previous})` : ''}.`);

  const all = (await request('GET', '/collections')).map((collection) => collection.name);
  for (const old of collectionsToDelete(all, { current: name, previous })) {
    await request('DELETE', `/collections/${encodeURIComponent(old)}`);
    log(`Deleted ${old}.`);
  }

  const key = await ensureSearchKey(request, searchKey);
  log(
    key.created
      ? `Created a search-only key and saved it to ${relativeToRepo(envFile)} as TYPESENSE_SEARCH_KEY.`
      : `Reused the search-only key in ${relativeToRepo(envFile)}.`,
  );
  return { collection: name, documents, previous };
}

async function main() {
  const { values } = parseArgs({ options: { input: { type: 'string' } } });
  if (await fileExists(envFile)) {
    process.loadEnvFile(envFile);
  }
  const { TYPESENSE_ADMIN_KEY: adminKey, TYPESENSE_URL: url = 'http://localhost:8108' } = process.env;
  if (!adminKey) {
    throw new Error(`Set TYPESENSE_ADMIN_KEY in ${relativeToRepo(envFile)} (copy .env.example to start one).`);
  }
  // npm runs workspace scripts from pipeline/, but INIT_CWD is where the command was typed.
  const invokedFrom = process.env.INIT_CWD ?? process.cwd();
  const snapshotDir = values.input ? path.resolve(invokedFrom, values.input) : await findNewestCleanSnapshot();
  const started = performance.now();
  await runLoad({
    snapshotDir,
    request: typesenseClient({ url, key: adminKey }),
    searchKey: process.env.TYPESENSE_SEARCH_KEY,
  });
  console.log(`Loaded ${relativeToRepo(snapshotDir)} in ${((performance.now() - started) / 1000).toFixed(1)} s.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
