// GET /api/health (spec 004 AC9): { ok, dataDate, total } for the default
// view, or HTTP 503 when Typesense can't be reached. The hourly site check
// reads it. It skips rate limits, so the check keeps working when they're on,
// and everything it returns is already in the site's footer and start page.
import { checkHealth } from '@/lib/server/health';

export async function GET() {
  const health = await checkHealth();
  if (!health.ok) {
    return Response.json({ ok: false, error: 'Search is unavailable right now.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  return Response.json(health, { headers: { 'Cache-Control': 'no-store' } });
}
