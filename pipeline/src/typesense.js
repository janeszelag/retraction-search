// A small client for Typesense's HTTP API, using the admin key.
import { fileExists } from './files.js';

// The names the site searches: the alias over the current snapshot's
// collection, and the one-document collection with the data date.
export const ALIAS = 'retractions';
export const META_COLLECTION = 'meta';

export class TypesenseError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Returns request(method, path, { body, query, text }). A body that's a string
// is sent as is (for JSON lines); anything else is sent as JSON. Responses are
// parsed as JSON unless `text` is set.
export function typesenseClient({ url, key }) {
  return async function request(method, pathname, { body, query, text = false } = {}) {
    const target = new URL(pathname, url);
    for (const [name, value] of Object.entries(query ?? {})) {
      target.searchParams.set(name, String(value));
    }
    let response;
    try {
      response = await fetch(target, {
        method,
        headers: { 'X-TYPESENSE-API-KEY': key, 'Content-Type': 'application/json' },
        body: body === undefined || typeof body === 'string' ? body : JSON.stringify(body),
      });
    } catch (error) {
      throw new TypesenseError(`Can't reach Typesense at ${url} (${error.cause?.code ?? error.message}). Is it running? Start it with npm run search:up.`);
    }
    const content = await response.text();
    if (!response.ok) {
      let message = content;
      try {
        message = JSON.parse(content).message ?? content;
      } catch {
        // Not JSON: keep the text.
      }
      throw new TypesenseError(`Typesense ${method} ${pathname} failed with HTTP ${response.status}: ${message}`, response.status);
    }
    return text ? content : JSON.parse(content);
  };
}

// TYPESENSE_URL and TYPESENSE_ADMIN_KEY come from the environment first,
// then the env file. A file given with --server-env must exist.
export async function readServerSettings(envFile, { required = false } = {}) {
  if (await fileExists(envFile)) {
    // Node's loader keeps values already in the environment.
    process.loadEnvFile(envFile);
  } else if (required) {
    throw new Error(`Can't find ${envFile}.`);
  }
  const { TYPESENSE_ADMIN_KEY: key, TYPESENSE_URL: url } = process.env;
  if (!key || !url) {
    throw new Error(`Set TYPESENSE_URL and TYPESENSE_ADMIN_KEY in the environment or in ${envFile}.`);
  }
  return { url, key };
}
