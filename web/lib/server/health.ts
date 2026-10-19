// What GET /api/health answers (spec 004 AC9): the data date and the default
// view's total, read through the same search code as the start page, so the
// scheduled site check fails when the start page would.
import 'server-only';
import { parseQuery } from '../query/url';
import { loadMeta, runSearch } from './search';
import { typesenseClient, type TypesenseClient } from './typesense';

export type Health = { ok: true; dataDate: string; total: number } | { ok: false };

export async function checkHealth(client: TypesenseClient = typesenseClient): Promise<Health> {
  // Both log their own failures.
  const meta = await loadMeta(client);
  if (!meta) {
    return { ok: false };
  }
  const result = await runSearch(parseQuery(new URLSearchParams()), client, meta);
  if (result.status !== 'ok') {
    return { ok: false };
  }
  return { ok: true, dataDate: meta.dataDate, total: result.found };
}
