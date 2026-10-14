// Runs a search for a page (spec 002, task 10). Server-only, like the client it uses.
import 'server-only';
import { cache } from 'react';
import { toTypesense } from '../query/typesense';
import type { Query } from '../query/types';
import { onlyCloseSpellings, parseMeta, parseSearch } from '../search/parse';
import type { Meta, SearchResult } from '../search/types';
import { typesenseClient, type TypesenseClient } from './typesense';

function logFailure(what: string, error: unknown) {
  console.error(`${what} failed: ${error instanceof Error ? error.message : String(error)}`);
}

export async function loadMeta(client: TypesenseClient = typesenseClient): Promise<Meta | null> {
  try {
    return parseMeta(await client.meta());
  } catch (error) {
    logFailure('Reading the data date', error);
    return null;
  }
}

// Once per request: the layout and the page share it.
export const getMeta = cache(() => loadMeta());

export async function runSearch(query: Query, client: TypesenseClient = typesenseClient, meta?: Meta | null): Promise<SearchResult> {
  try {
    const snapshot = meta === undefined ? await loadMeta(client) : meta;
    if (!snapshot) {
      return { status: 'unavailable' };
    }
    let plan = toTypesense(query);
    let results = await client.multiSearch(plan.searches);
    // Nothing matched exactly, so Typesense showed close spellings. Ask again
    // with typos on for every search, so the counts agree with the results (spike S6).
    const closeSpellings = onlyCloseSpellings(plan, results);
    if (closeSpellings) {
      plan = toTypesense(query, { typos: 'always' });
      results = await client.multiSearch(plan.searches);
    }
    return parseSearch({ query, plan, results, meta: snapshot, closeSpellings });
  } catch (error) {
    // The page says search is unavailable instead of failing (AC29).
    logFailure('Search', error);
    return { status: 'unavailable' };
  }
}
