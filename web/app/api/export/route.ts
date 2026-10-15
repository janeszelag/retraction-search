// GET /api/export?…the search's own parameters
// The CSV download (spec 002 AC23). A route handler can answer with a stream:
// the Response's body is a ReadableStream, and Next.js sends each piece to the
// visitor as the server code produces it, so even the whole default view
// (67,384 records) never sits in the server's memory at once.
import type { NextRequest } from 'next/server';
import { parseQuery } from '@/lib/query/url';
import { startExport } from '@/lib/server/export';
import { siteOrigin } from '@/lib/server/origin';
import { checkLimit, limitedResponse } from '@/lib/server/rate-limit';

export async function GET(request: NextRequest) {
  const query = parseQuery(request.nextUrl.searchParams);
  // Downloads have a stricter limit of their own (AC28).
  const limit = await checkLimit('downloads');
  if (limit.status === 'limited') {
    return limitedResponse(limit, 'Download limit reached.');
  }
  // request.signal aborts when the visitor cancels, which stops the reads from Typesense.
  const result = await startExport(query, await siteOrigin(), { signal: request.signal });
  if (result.status === 'unavailable') {
    return Response.json({ error: 'Search is unavailable right now.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  return new Response(result.body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      // "attachment" makes a browser save the file instead of showing it.
      'Content-Disposition': `attachment; filename="${result.fileName}"`,
      'Cache-Control': 'no-store',
      'X-Record-Count': String(result.total),
    },
  });
}
