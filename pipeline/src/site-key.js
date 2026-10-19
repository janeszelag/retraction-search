// Creates or reuses the site's Typesense key, which can only search and
// export, and writes it to an env file as TYPESENSE_SEARCH_KEY (spec 004,
// AC4). npm run load calls the same function for .env.local. The daily
// update never does (spec 003, AC18).
// Usage: npm run site-key [-- --server-env <path>]  (default: .env.local)
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import { fileExists } from './files.js';
import { relativeToRepo, repoRoot } from './paths.js';
import { ALIAS, META_COLLECTION, readServerSettings, typesenseClient } from './typesense.js';

// Keys this command creates are recognized by this start of their description.
const KEY_DESCRIPTION_PREFIX = 'retraction-search: ';
export const SITE_KEY = {
  description: `${KEY_DESCRIPTION_PREFIX}site (search and export, read only)`,
  actions: ['documents:search', 'documents:export'],
  // Typesense checks these against the name a search asks for, so the alias is enough (spike S5).
  collections: [ALIAS, META_COLLECTION],
};

// Sets NAME=value in the text of an env file, replacing an existing line or adding one.
export function withEnvValue(text, name, value) {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  if (pattern.test(text)) {
    return text.replace(pattern, () => line);
  }
  return `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${line}\n`;
}

function isSiteKey(key) {
  return (
    key.description === SITE_KEY.description &&
    JSON.stringify(key.actions) === JSON.stringify(SITE_KEY.actions) &&
    JSON.stringify(key.collections) === JSON.stringify(SITE_KEY.collections)
  );
}

// Reuses the key in envFile if the server still has it. Otherwise creates
// one and writes it to envFile. Either way, deletes other keys made this way
// before. Logs and returns the key's id, never the key.
export async function ensureSiteKey({ request, envFile, log = console.log }) {
  const text = (await fileExists(envFile)) ? await readFile(envFile, 'utf8') : '';
  const current = parseEnv(text).TYPESENSE_SEARCH_KEY;
  const { keys } = await request('GET', '/keys');
  const ours = keys.filter((key) => key.description?.startsWith(KEY_DESCRIPTION_PREFIX));
  // Typesense lists a key's first few characters, never the whole key.
  let keep = current ? ours.find((key) => isSiteKey(key) && current.startsWith(key.value_prefix)) : undefined;
  const created = !keep;
  if (created) {
    keep = await request('POST', '/keys', { body: SITE_KEY });
    await writeFile(envFile, withEnvValue(text, 'TYPESENSE_SEARCH_KEY', keep.value));
  }
  const deleted = [];
  for (const key of ours.filter((key) => key.id !== keep.id)) {
    await request('DELETE', `/keys/${key.id}`);
    deleted.push(key.id);
  }

  const file = relativeToRepo(envFile);
  log(
    created
      ? `Created the site's key (id ${keep.id}) and saved it to ${file} as TYPESENSE_SEARCH_KEY.`
      : `Reused the site's key in ${file} (id ${keep.id}).`,
  );
  if (deleted.length > 0) {
    log(`Deleted ${deleted.length === 1 ? 'an older site key' : `${deleted.length} older site keys`} (id ${deleted.join(', ')}).`);
  }
  return { created, id: keep.id, deleted };
}

async function main() {
  const { values } = parseArgs({
    // Not --env-file: Node checks a path given with that name itself (see update.js).
    options: { 'server-env': { type: 'string' } },
  });
  // npm runs workspace scripts from pipeline/, but INIT_CWD is where the command was typed.
  const invokedFrom = process.env.INIT_CWD ?? process.cwd();
  const envFile = values['server-env'] ? path.resolve(invokedFrom, values['server-env']) : path.join(repoRoot, '.env.local');
  const { url, key } = await readServerSettings(envFile, { required: Boolean(values['server-env']) });
  await ensureSiteKey({ request: typesenseClient({ url, key }), envFile });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
