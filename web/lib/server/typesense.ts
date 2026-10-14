// The site's connection to Typesense. Only server code can import this file:
// the server-only package makes a build fail if a client component does, so the
// key never reaches a browser (spec 002 AC27).
import 'server-only';
import { COLLECTION, type TypesenseSearch } from '../query/typesense';
import type { TypesenseResult } from '../search/parse';

export class SearchUnavailableError extends Error {}

// A search that takes longer than this counts as unavailable.
const TIMEOUT_MS = 5000;

export interface TypesenseClient {
  multiSearch(searches: TypesenseSearch[]): Promise<TypesenseResult[]>;
  meta(): Promise<Record<string, unknown>>;
  // Every matching document as JSON lines, as Typesense sends them (spike S4).
  exportDocuments(params: { filterBy?: string; includeFields: string; signal?: AbortSignal }): Promise<ReadableStream<Uint8Array>>;
}

// Read on every call, not when the module loads, so the values come from the
// running server's environment rather than the build's.
function config() {
  const url = process.env.TYPESENSE_URL;
  const key = process.env.TYPESENSE_SEARCH_KEY;
  if (!url || !key) {
    throw new SearchUnavailableError('TYPESENSE_URL and TYPESENSE_SEARCH_KEY must be set (see .env.example).');
  }
  return { url, key };
}

async function post(path: string, body: unknown): Promise<unknown> {
  const { url, key } = config();
  let response: Response;
  try {
    response = await fetch(new URL(path, url), {
      method: 'POST',
      headers: { 'X-TYPESENSE-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    throw new SearchUnavailableError(`Typesense can't be reached at ${url}: ${(error as Error).message}`);
  }
  if (!response.ok) {
    throw new SearchUnavailableError(`Typesense answered HTTP ${response.status} for ${path}.`);
  }
  return response.json();
}

export const typesenseClient: TypesenseClient = {
  async multiSearch(searches) {
    const body = (await post('/multi_search', { searches })) as { results?: TypesenseResult[] };
    return body.results ?? [];
  },
  async meta() {
    // The site's key can search but not fetch documents, so the one meta document is found by searching.
    const [result] = await this.multiSearch([{ collection: 'meta', q: '*', per_page: 1 }]);
    const document = result?.hits?.[0]?.document;
    if (!document) {
      throw new SearchUnavailableError('The meta collection has no document. Run npm run load.');
    }
    return document;
  },
  async exportDocuments({ filterBy, includeFields, signal }) {
    const { url, key } = config();
    const endpoint = new URL(`/collections/${COLLECTION}/documents/export`, url);
    if (filterBy) {
      endpoint.searchParams.set('filter_by', filterBy);
    }
    endpoint.searchParams.set('include_fields', includeFields);
    // The timeout covers waiting for Typesense to start answering, not the
    // whole file, which streams for as long as it takes.
    const started = new AbortController();
    const timer = setTimeout(() => started.abort(new Error(`no answer in ${TIMEOUT_MS} ms`)), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        headers: { 'X-TYPESENSE-API-KEY': key },
        signal: signal ? AbortSignal.any([signal, started.signal]) : started.signal,
        cache: 'no-store',
      });
    } catch (error) {
      throw new SearchUnavailableError(`Typesense can't be reached at ${url}: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok || !response.body) {
      throw new SearchUnavailableError(`Typesense answered HTTP ${response.status} for the export.`);
    }
    return response.body;
  },
};
