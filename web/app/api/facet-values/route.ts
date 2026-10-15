// GET /api/facet-values?facet=journal&facet_find=nucleic&…the search's own parameters
// Finds journals or publishers by name for a filter's search box (spec 002 AC6).
// A route handler: server code that answers with JSON instead of a page, so
// the browser asks the site, and only the site asks Typesense (AC27).
import type { NextRequest } from 'next/server';
import { parseQuery } from '@/lib/query/url';
import { checkLimit, limitedResponse } from '@/lib/server/rate-limit';
import { runFacetValueSearch } from '@/lib/server/search';

const MAX_FIND_LENGTH = 100;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const facet = params.get('facet');
  if (facet !== 'journal' && facet !== 'publisher') {
    return Response.json({ error: 'facet must be journal or publisher' }, { status: 400 });
  }
  const find = (params.get('facet_find') ?? '').trim().replace(/\s+/g, ' ');
  // One letter matches nothing in Typesense, and very long text is never a name.
  if (find.length < 2 || find.length > MAX_FIND_LENGTH) {
    return Response.json({ values: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }
  // Each value search counts as a search toward the visitor's limit (AC28).
  const limit = await checkLimit('searches');
  if (limit.status === 'limited') {
    return limitedResponse(limit, 'Too many searches in a short time.');
  }
  const result = await runFacetValueSearch(parseQuery(params), facet, find);
  if (result.status === 'unavailable') {
    return Response.json({ error: 'Search is unavailable right now.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  return Response.json({ values: result.values }, { headers: { 'Cache-Control': 'no-store' } });
}
