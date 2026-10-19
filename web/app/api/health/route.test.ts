import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkHealth } from '@/lib/server/health';
import { checkLimit } from '@/lib/server/rate-limit';
import { GET } from './route';

vi.mock('@/lib/server/health', () => ({ checkHealth: vi.fn() }));
vi.mock('@/lib/server/rate-limit', () => ({ checkLimit: vi.fn() }));

beforeEach(() => {
  vi.mocked(checkHealth).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/health (spec 004, task 5, AC9)', () => {
  it('answers 200 with ok, the data date and the total, never cached', async () => {
    vi.mocked(checkHealth).mockResolvedValue({ ok: true, dataDate: '2026-10-16', total: 67400 });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true, dataDate: '2026-10-16', total: 67400 });
  });

  it('answers 503 when Typesense can’t be reached, never cached', async () => {
    vi.mocked(checkHealth).mockResolvedValue({ ok: false });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: false, error: 'Search is unavailable right now.' });
  });

  it('skips rate limits', async () => {
    vi.mocked(checkHealth).mockResolvedValue({ ok: true, dataDate: '2026-10-16', total: 67400 });
    await GET();
    expect(checkLimit).not.toHaveBeenCalled();
  });
});
