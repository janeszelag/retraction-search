// Runs a search for a page (spec 002, task 10). Server-only, like the client it uses.
import 'server-only';
import { cache } from 'react';
import { COLLECTION, toExactValueSearch, toFacetValueSearch, toTypesense } from '../query/typesense';
import type { Query } from '../query/types';
import { onlyCloseSpellings, parseFacetValues, parseMeta, parseRecord, parseSearch } from '../search/parse';
import type { Meta, ResultRecord, SearchResult, ValueCount } from '../search/types';
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

// Finds journals or publishers by name for a filter's search box.
export async function runFacetValueSearch(
  query: Query,
  part: 'journal' | 'publisher',
  find: string,
  client: TypesenseClient = typesenseClient,
): Promise<{ status: 'ok'; values: ValueCount[] } | { status: 'unavailable' }> {
  try {
    const meta = await loadMeta(client);
    if (!meta) {
      return { status: 'unavailable' };
    }
    const [found, exact] = await client.multiSearch([toFacetValueSearch(query, part, find), toExactValueSearch(query, part, find)]);
    // A value named exactly as typed comes first, then the rest by count.
    const exactValues = parseFacetValues(exact ?? {}, part, meta);
    const values = parseFacetValues(found ?? {}, part, meta);
    return { status: 'ok', values: [...exactValues, ...values.filter((entry) => !exactValues.some((other) => other.value === entry.value))] };
  } catch (error) {
    logFailure('Value search', error);
    return { status: 'unavailable' };
  }
}

// One record for its page. The site's key can search but not fetch documents,
// so the record is found by a search filtered to its ID (plan 002, "Pages").
export async function getRecord(
  id: number,
  client: TypesenseClient = typesenseClient,
): Promise<{ status: 'ok'; record: ResultRecord } | { status: 'not-found' } | { status: 'unavailable' }> {
  try {
    const [result] = await client.multiSearch([{ collection: COLLECTION, q: '*', filter_by: `record_id:=${id}`, per_page: 1 }]);
    if (result?.error) {
      throw new Error(result.error);
    }
    const hit = result?.hits?.[0];
    return hit ? { status: 'ok', record: parseRecord(hit) } : { status: 'not-found' };
  } catch (error) {
    logFailure('Reading a record', error);
    return { status: 'unavailable' };
  }
}
