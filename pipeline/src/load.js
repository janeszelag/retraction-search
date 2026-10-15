// Loads one cleaned snapshot into Typesense (spec 002, plan "Data in Typesense").
// importSnapshot, switchTo and cleanUp are the steps that npm run load and
// npm run update share (spec 003). Only npm run load touches keys.
// Usage: npm run load [-- --input <folder>]  (default: the newest folder in data/clean)
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { fileExists } from './files.js';
import { cleanDir, rawDir, relativeToRepo, repoRoot } from './paths.js';
import { typesenseClient } from './typesense.js';

export const ALIAS = 'retractions';
export const META_COLLECTION = 'meta';
// Keys the load creates are recognized by this start of their description.
const KEY_DESCRIPTION_PREFIX = 'retraction-search: ';
export const SITE_KEY = {
  description: `${KEY_DESCRIPTION_PREFIX}site (search and export, read only)`,
  actions: ['documents:search', 'documents:export'],
  // Typesense checks these against the name a search asks for, so the alias is enough (spike S5).
  collections: [ALIAS, META_COLLECTION],
};
const BATCH_SIZE = 5000;
const envFile = path.join(repoRoot, '.env.local');

export const TOKEN_SEPARATORS = ['-', '/'];

// Fields outside the schema are stored and returned but not indexed:
// urls, url_record_counts, notes and original (decision record 002).
export function collectionSchema(name) {
  const facet = (fieldName, type) => ({ name: fieldName, type, facet: true });
  // Hyphens and slashes split words in these fields, so "cancer" finds
  // "cancer-associated" and "Wnt/beta-catenin". Without this, Typesense joins
  // them into one word ("cancerassociated"), and a third of titles hold one.
  // Author names and the filter lists keep the default: on a list field,
  // Typesense's exact filter then matches names that share only some words.
  const split = { token_separators: TOKEN_SEPARATORS };
  return {
    name,
    fields: [
      // Searched by the search box and field terms.
      { name: 'title', type: 'string', ...split },
      { name: 'authors', type: 'string[]' },
      { name: 'institutions', type: 'string[]', ...split },
      // Searched, and filters.
      { ...facet('journal', 'string'), ...split },
      { ...facet('publisher', 'string'), ...split },
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

export class ValueCheckError extends Error {}
// The two checks of what Typesense stored. A new import can pass them, so
// the update retries these, once (spec 003, AC9).
export class DocumentCheckError extends ValueCheckError {}
export class FacetCheckError extends ValueCheckError {}

// Typesense returns at most the first 255 bytes of a facet value, ending on a
// whole character (spike S2).
const FACET_VALUE_BYTES = 255;
const encoder = new TextEncoder();

export function cutFacetValue(value) {
  if (encoder.encode(value).length <= FACET_VALUE_BYTES) {
    return value;
  }
  let cut = '';
  let bytes = 0;
  for (const character of value) {
    bytes += encoder.encode(character).length;
    if (bytes > FACET_VALUE_BYTES) {
      break;
    }
    cut += character;
  }
  return cut;
}

// Maps each cut value to its full name. Fails if two names would share a
// facet value, since Typesense would merge their counts.
export function cutNames(field, names) {
  const full = new Set(names);
  const map = new Map();
  for (const name of [...full].sort()) {
    const cut = cutFacetValue(name);
    if (cut === name) {
      continue;
    }
    if (full.has(cut) || map.has(cut)) {
      throw new ValueCheckError(`Two ${field} values share their first 255 bytes, so their counts would merge: "${cut}".`);
    }
    map.set(cut, name);
  }
  return Object.fromEntries(map);
}

// Facet values that are neither a name nor a known cut value, and cut values
// Typesense didn't return. Either means Typesense cut values differently.
export function unexpectedFacetValues(facetValues, names, cut) {
  const known = new Set([...names, ...Object.keys(cut)]);
  const returned = new Set(facetValues);
  return [
    ...facetValues.filter((value) => !known.has(value)),
    ...Object.keys(cut).filter((value) => !returned.has(value)),
  ];
}

// Typesense's exact filters ignore capitals and accents (spike S8), so values
// of these fields that differ only in those would be merged. The cleaning
// merges journal and publisher spellings; the check makes sure of it.
export const STRING_FILTER_FIELDS = [
  'journal',
  'publisher',
  'notice_type',
  'paywalled',
  'reasons',
  'subjects',
  'subject_categories',
  'countries',
  'article_types',
];

const fold = (value) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

export function valuesDifferingInCaseOrAccents(field, values) {
  const groups = new Map();
  for (const value of values) {
    const key = fold(value);
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => `${field}: ${group.sort().map((value) => `"${value}"`).join(', ')}`);
}

// Reads the documents once to collect the values the checks need.
async function scanDocuments(file) {
  const values = Object.fromEntries(STRING_FILTER_FIELDS.map((field) => [field, new Set()]));
  for await (const batch of batchesOf(file, BATCH_SIZE)) {
    for (const line of batch) {
      const doc = JSON.parse(line);
      for (const field of STRING_FILTER_FIELDS) {
        for (const value of [doc[field] ?? []].flat()) {
          values[field].add(value);
        }
      }
    }
  }
  return values;
}

// Checks the documents before anything is loaded.
export function checkValues(values) {
  const problems = STRING_FILTER_FIELDS.flatMap((field) => valuesDifferingInCaseOrAccents(field, values[field]));
  if (problems.length > 0) {
    throw new ValueCheckError(
      `Some filter values differ only in capitals or accents, so Typesense's filters would merge them: ${problems.join('; ')}.`,
    );
  }
  return { journal: cutNames('journal', values.journal), publisher: cutNames('publisher', values.publisher) };
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

// Writes every non-ASCII character as a \uXXXX escape, so the request body
// is pure ASCII. Typesense reads an import in slices of 196,605 bytes and
// drops a character that a slice boundary cuts in two (typesense/typesense#3071,
// decision record 004). JSON reads the escape as the same character.
export function escapeNonAscii(jsonText) {
  return jsonText.replace(/[\u0080-\uffff]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

// JSON with the keys of every object sorted, since Typesense changes the
// order of keys inside object fields such as `original`.
export function canonicalJson(value) {
  return JSON.stringify(value, (_key, entry) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : entry,
  );
}

// The fields whose stored value differs from the one sent.
export function differingFields(sent, stored) {
  return [...new Set([...Object.keys(sent), ...Object.keys(stored)])]
    .filter((field) => canonicalJson(sent[field]) !== canonicalJson(stored[field]))
    .sort();
}

const MAX_LISTED = 10;
const listed = (items) =>
  items.length > MAX_LISTED ? `${items.slice(0, MAX_LISTED).join(', ')} and ${items.length - MAX_LISTED} more` : items.join(', ');
const hashOf = (text) => createHash('sha256').update(text).digest('base64');

// Exports the collection and compares every document with the cleaned file
// (decision record 004). Keeps a hash per document rather than the file.
// The error names records and fields but never their text, since it can end
// up in a public issue (spec 003, AC6).
async function checkStoredDocuments(request, name, documentsFile) {
  const expected = new Map();
  for await (const batch of batchesOf(documentsFile, BATCH_SIZE)) {
    for (const line of batch) {
      const doc = JSON.parse(line);
      expected.set(String(doc.id), hashOf(canonicalJson(doc)));
    }
  }
  const exported = await request('GET', `/collections/${encodeURIComponent(name)}/documents/export`, { text: true });
  const differing = new Map();
  const unexpected = [];
  for (const line of exported.split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    const stored = JSON.parse(line);
    const id = String(stored.id);
    const hash = expected.get(id);
    if (hash === undefined) {
      unexpected.push(id);
      continue;
    }
    expected.delete(id);
    if (hash !== hashOf(canonicalJson(stored))) {
      differing.set(id, stored);
    }
  }
  const missing = [...expected.keys()];
  if (differing.size === 0 && missing.length === 0 && unexpected.length === 0) {
    return;
  }

  const problems = [];
  if (differing.size > 0) {
    const records = [];
    for await (const batch of batchesOf(documentsFile, BATCH_SIZE)) {
      for (const line of batch) {
        const sent = JSON.parse(line);
        const stored = differing.get(String(sent.id));
        if (stored) {
          records.push(`record ${sent.id} (${differingFields(sent, stored).join(', ')})`);
        }
      }
    }
    problems.push(`${records.length} stored differently from the cleaned file: ${listed(records)}`);
  }
  if (missing.length > 0) {
    problems.push(`${missing.length} missing: ${listed(missing.map((id) => `record ${id}`))}`);
  }
  if (unexpected.length > 0) {
    problems.push(`${unexpected.length} not in the cleaned file: ${listed(unexpected.map((id) => `record ${id}`))}`);
  }
  throw new DocumentCheckError(
    `Typesense's documents don't match the cleaned file. Documents ${problems.join('; ')}. The import reported success, so Typesense changed them as it stored them (see decision record 004).`,
  );
}

// Checks that Typesense cut journal and publisher values the way checkValues expects.
async function checkFacetValues(request, name, values, cut) {
  const result = await request('GET', `/collections/${encodeURIComponent(name)}/documents/search`, {
    query: { q: '*', facet_by: 'journal,publisher', max_facet_values: 100000, per_page: 0 },
  });
  for (const { field_name: field, counts } of result.facet_counts) {
    const unexpected = unexpectedFacetValues(counts.map((count) => count.value), values[field], cut[field]);
    if (unexpected.length > 0) {
      throw new FacetCheckError(`Typesense's ${field} values don't match the documents: ${unexpected.map((value) => `"${value}"`).join(', ')}.`);
    }
  }
}

async function importDocuments(request, name, documentsFile) {
  let imported = 0;
  for await (const batch of batchesOf(documentsFile, BATCH_SIZE)) {
    const response = await request('POST', `/collections/${encodeURIComponent(name)}/documents/import`, {
      query: { action: 'create', dirty_values: 'reject', return_id: true },
      body: escapeNonAscii(batch.join('\n')),
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

function isSiteKey(key) {
  return (
    key.description === SITE_KEY.description &&
    JSON.stringify(key.actions) === JSON.stringify(SITE_KEY.actions) &&
    JSON.stringify(key.collections) === JSON.stringify(SITE_KEY.collections)
  );
}

// Reuses the site's key in .env.local if Typesense still has it. Otherwise
// creates one and saves it to .env.local. Either way, deletes other keys the
// load made before.
async function ensureSiteKey(request, currentValue) {
  const { keys } = await request('GET', '/keys');
  const ours = keys.filter((key) => key.description?.startsWith(KEY_DESCRIPTION_PREFIX));
  let keep = currentValue ? ours.find((key) => isSiteKey(key) && currentValue.startsWith(key.value_prefix)) : undefined;
  const created = !keep;
  if (created) {
    keep = await request('POST', '/keys', { body: SITE_KEY });
    const text = (await fileExists(envFile)) ? await readFile(envFile, 'utf8') : '';
    await writeFile(envFile, withEnvValue(text, 'TYPESENSE_SEARCH_KEY', keep.value));
  }
  for (const key of ours.filter((key) => key.id !== keep.id)) {
    await request('DELETE', `/keys/${key.id}`);
  }
  return { created };
}

// The meta document, or null when there isn't one yet.
export async function readMeta(request) {
  try {
    const { id: _id, ...meta } = await request('GET', `/collections/${META_COLLECTION}/documents/current`);
    return meta;
  } catch (error) {
    if (error.status === 404) {
      return null;
    }
    throw error;
  }
}

// Step 1: creates a new collection, imports the snapshot, and checks the
// count, every stored document and the facet values. If a check fails, it
// deletes the collection and throws. Search doesn't change.
export async function importSnapshot({ snapshotDir, request, log = console.log, now = new Date() }) {
  const snapshot = describeSnapshotDir(snapshotDir);
  const documentsFile = path.join(snapshotDir, 'search-documents.jsonl');
  const name = collectionName(snapshot, now);
  const values = await scanDocuments(documentsFile);
  const cut = checkValues(values);

  await request('POST', '/collections', { body: collectionSchema(name) });
  let documents;
  try {
    const imported = await importDocuments(request, name, documentsFile);
    documents = (await request('GET', `/collections/${encodeURIComponent(name)}`)).num_documents;
    if (documents !== imported) {
      throw new ImportError(`${name} holds ${documents} documents, but ${imported} were imported.`);
    }
    await checkStoredDocuments(request, name, documentsFile);
    await checkFacetValues(request, name, values, cut);
  } catch (error) {
    await request('DELETE', `/collections/${encodeURIComponent(name)}`).catch(() => {});
    throw error;
  }
  log(`Imported ${documents} documents into ${name}, and every stored document matches the cleaned file.`);
  return { collection: name, documents, cut, snapshot };
}

// Step 2: points the alias at the new collection and writes the meta
// document. Returns the alias target and meta document from before, so the
// update can put them back.
export async function switchTo({ request, imported, upstreamCommit = null, now = new Date(), log = console.log }) {
  const previous = await previousAliasTarget(request);
  const previousMeta = await readMeta(request);
  await request('PUT', `/aliases/${ALIAS}`, { body: { collection_name: imported.collection } });
  const meta = {
    data_date: imported.snapshot.dataDate,
    commit: imported.snapshot.commit,
    // The full SHA, so the next update can download this snapshot again to diff against.
    upstream_commit: upstreamCommit,
    collection: imported.collection,
    documents: imported.documents,
    loaded_at: now.toISOString(),
    // Full names for the journal and publisher facet values Typesense cut short.
    cut_names: imported.cut,
  };
  try {
    await writeMeta(request, meta);
  } catch (error) {
    // The alias and the meta document must agree, so put the alias back.
    if (previous) {
      await request('PUT', `/aliases/${ALIAS}`, { body: { collection_name: previous } }).catch(() => {});
    }
    throw error;
  }
  log(`Pointed the ${ALIAS} alias at ${imported.collection}${previous ? ` (it was ${previous})` : ''}.`);
  log(
    `Stored full names for ${Object.keys(imported.cut.journal).length} journal and ${Object.keys(imported.cut.publisher).length} publisher values cut at 255 bytes.`,
  );
  return { previous, previousMeta, meta };
}

// Undoes switchTo: points the alias back at the previous collection, puts
// back the previous meta document and deletes the new collection. After a
// first load there's nothing to go back to, so search keeps the new one.
// Returns whether it went back.
export async function switchBack({ request, switched, collection, log = console.log }) {
  if (!switched.previous) {
    log(`There was no previous collection to go back to, so the ${ALIAS} alias stays on ${collection}.`);
    return false;
  }
  await request('PUT', `/aliases/${ALIAS}`, { body: { collection_name: switched.previous } });
  if (switched.previousMeta) {
    await writeMeta(request, switched.previousMeta);
  } else {
    await request('DELETE', `/collections/${META_COLLECTION}/documents/current`);
  }
  await request('DELETE', `/collections/${encodeURIComponent(collection)}`);
  log(`Pointed the ${ALIAS} alias back at ${switched.previous}, restored the meta document and deleted ${collection}.`);
  return true;
}

// Step 3: deletes snapshot collections other than the current and previous ones.
export async function cleanUp({ request, current, previous, log = console.log }) {
  const all = (await request('GET', '/collections')).map((collection) => collection.name);
  const deleted = collectionsToDelete(all, { current, previous });
  for (const old of deleted) {
    await request('DELETE', `/collections/${encodeURIComponent(old)}`);
    log(`Deleted ${old}.`);
  }
  return deleted;
}

// npm run load: the three steps, then the site's key.
export async function runLoad({ snapshotDir, request, searchKey, upstreamCommit = null, log = console.log, now = new Date() }) {
  const imported = await importSnapshot({ snapshotDir, request, log, now });
  const { previous } = await switchTo({ request, imported, upstreamCommit, now, log });
  await cleanUp({ request, current: imported.collection, previous, log });
  const key = await ensureSiteKey(request, searchKey);
  log(
    key.created
      ? `Created the site's key and saved it to ${relativeToRepo(envFile)} as TYPESENSE_SEARCH_KEY.`
      : `Reused the site's key in ${relativeToRepo(envFile)}.`,
  );
  return { collection: imported.collection, documents: imported.documents, previous };
}

// The full upstream commit, from the download's manifest for this snapshot.
async function upstreamCommitFor(snapshotDir) {
  const manifestPath = path.join(rawDir, `retraction_watch-${path.basename(snapshotDir)}.json`);
  if (!(await fileExists(manifestPath))) {
    return null;
  }
  return JSON.parse(await readFile(manifestPath, 'utf8')).commit ?? null;
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
  const upstreamCommit = await upstreamCommitFor(snapshotDir);
  if (!upstreamCommit) {
    console.log(
      `No download manifest for ${path.basename(snapshotDir)} in ${relativeToRepo(rawDir)}, so the meta document won't name its upstream commit, and the next npm run update can't diff against it.`,
    );
  }
  const started = performance.now();
  await runLoad({
    snapshotDir,
    request: typesenseClient({ url, key: adminKey }),
    searchKey: process.env.TYPESENSE_SEARCH_KEY,
    upstreamCommit,
  });
  console.log(`Loaded ${relativeToRepo(snapshotDir)} in ${((performance.now() - started) / 1000).toFixed(1)} s.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
