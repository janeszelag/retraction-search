import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkLimit, limitsOff, rules, visitorId, type CounterStore } from './rate-limit';

const now = Date.parse('2026-10-14T15:42:20Z');

// A counter store in memory, recording what it was asked.
function memoryStore() {
  const counts = new Map<string, number>();
  const calls: { key: string; ttlSeconds: number }[] = [];
  const store: CounterStore = {
    async increment(key, ttlSeconds) {
      calls.push({ key, ttlSeconds });
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts.get(key)!;
    },
  };
  return { store, calls };
}

beforeEach(() => {
  vi.stubEnv('VISITOR_HASH_SALT', 'test salt');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('per-visitor limits (task 19, AC28)', () => {
  it('lets 60 searches a minute through and refuses the 61st until the minute ends', async () => {
    const { store } = memoryStore();
    const check = () => checkLimit('searches', { store, forwardedFor: '203.0.113.7', now });
    for (let index = 0; index < 60; index += 1) {
      expect(await check()).toEqual({ status: 'ok' });
    }
    expect(await check()).toEqual({ status: 'limited', retryAfter: 40, rule: { max: 60, windowSeconds: 60 } });
    // A new minute starts a new count.
    expect(await checkLimit('searches', { store, forwardedFor: '203.0.113.7', now: now + 40_000 })).toEqual({ status: 'ok' });
  });

  it('counts downloads separately, 6 an hour', async () => {
    const { store } = memoryStore();
    for (let index = 0; index < 6; index += 1) {
      expect(await checkLimit('downloads', { store, forwardedFor: '203.0.113.7', now })).toEqual({ status: 'ok' });
    }
    expect(await checkLimit('downloads', { store, forwardedFor: '203.0.113.7', now })).toMatchObject({ status: 'limited', retryAfter: 1060 });
    expect(await checkLimit('searches', { store, forwardedFor: '203.0.113.7', now })).toEqual({ status: 'ok' });
  });

  it('keeps each visitor’s count apart, by the first address in x-forwarded-for', async () => {
    vi.stubEnv('RATE_LIMIT_SEARCHES', '1');
    const { store } = memoryStore();
    expect(await checkLimit('searches', { store, forwardedFor: '203.0.113.7, 10.0.0.1', now })).toEqual({ status: 'ok' });
    expect(await checkLimit('searches', { store, forwardedFor: '198.51.100.2, 10.0.0.1', now })).toEqual({ status: 'ok' });
    expect((await checkLimit('searches', { store, forwardedFor: '203.0.113.7', now })).status).toBe('limited');
  });

  it('stores a salted hash, never the address, with a counter that expires with its window', async () => {
    const { store, calls } = memoryStore();
    await checkLimit('downloads', { store, forwardedFor: '203.0.113.7', now });
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toMatch(/^limit:downloads:[0-9a-f]{32}:\d+$/);
    expect(calls[0].key).not.toContain('203.0.113.7');
    expect(calls[0].ttlSeconds).toBe(3600);
    expect(visitorId('203.0.113.7', 'test salt')).not.toBe(visitorId('203.0.113.7', 'another salt'));
  });

  it('can be lowered through the environment for tests', () => {
    expect(rules({ RATE_LIMIT_SEARCHES: '3', RATE_LIMIT_DOWNLOADS: '1' })).toEqual({
      searches: { max: 3, windowSeconds: 60 },
      downloads: { max: 1, windowSeconds: 3600 },
    });
    expect(rules({ RATE_LIMIT_SEARCHES: 'lots' }).searches.max).toBe(60);
  });
});

describe('when the counters fail (AC29)', () => {
  it('lets the request through and logs the failure when Redis is down', async () => {
    const store: CounterStore = {
      increment: async () => {
        throw new Error("Redis can't be reached at localhost:6379.");
      },
    };
    expect(await checkLimit('searches', { store, forwardedFor: '203.0.113.7', now })).toEqual({ status: 'ok' });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Rate limits are off: Redis can't be reached"));
  });

  it('stops waiting for a Redis that doesn’t answer', async () => {
    const store: CounterStore = { increment: () => new Promise(() => {}) };
    const started = performance.now();
    expect(await checkLimit('searches', { store, forwardedFor: '203.0.113.7', now })).toEqual({ status: 'ok' });
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('lets the request through without a salt, rather than storing unsalted hashes', async () => {
    vi.stubEnv('VISITOR_HASH_SALT', '');
    const { store, calls } = memoryStore();
    expect(await checkLimit('searches', { store, forwardedFor: '203.0.113.7', now })).toEqual({ status: 'ok' });
    expect(calls).toHaveLength(0);
  });
});

describe('RATE_LIMITS=off (spec 004, task 3, AC7)', () => {
  it('is off only when the setting is "off"', () => {
    expect(limitsOff({ RATE_LIMITS: 'off' })).toBe(true);
    expect(limitsOff({})).toBe(false);
    expect(limitsOff({ RATE_LIMITS: '' })).toBe(false);
    expect(limitsOff({ RATE_LIMITS: 'on' })).toBe(false);
  });

  it('lets every request through without a counter, an address, a salt or Redis', async () => {
    vi.stubEnv('RATE_LIMITS', 'off');
    vi.stubEnv('VISITOR_HASH_SALT', '');
    vi.stubEnv('REDIS_URL', 'redis://localhost:1');
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const { store, calls } = memoryStore();
    for (let index = 0; index < 100; index += 1) {
      expect(await checkLimit('searches', { store, forwardedFor: '203.0.113.7', now })).toEqual({ status: 'ok' });
    }
    // Without a store or an address given, the check would otherwise open Redis and read the request's headers.
    expect(await checkLimit('downloads')).toEqual({ status: 'ok' });
    expect(calls).toHaveLength(0);
    expect((globalThis as { rateLimitStore?: unknown }).rateLimitStore).toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('logs that the limits are off once per server, not per request or per copy of the module', async () => {
    vi.stubEnv('RATE_LIMITS', 'off');
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    // As a new server starts.
    delete (globalThis as { rateLimitsOffLogged?: boolean }).rateLimitsOffLogged;
    for (let index = 0; index < 3; index += 1) {
      await checkLimit('searches', { forwardedFor: '203.0.113.7', now });
    }
    // Next.js gives the pages and each route handler their own copy of the module.
    vi.resetModules();
    const routeHandlerCopy = await import('./rate-limit');
    await routeHandlerCopy.checkLimit('downloads', { forwardedFor: '203.0.113.7', now });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith('Rate limits are off (RATE_LIMITS=off).');
  });

  it('keeps the limits on when the setting is unset', async () => {
    vi.stubEnv('RATE_LIMIT_SEARCHES', '1');
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { store, calls } = memoryStore();
    expect(await checkLimit('searches', { store, forwardedFor: '203.0.113.7', now })).toEqual({ status: 'ok' });
    expect((await checkLimit('searches', { store, forwardedFor: '203.0.113.7', now })).status).toBe('limited');
    expect(calls).toHaveLength(2);
    expect(info).not.toHaveBeenCalled();
  });
});
