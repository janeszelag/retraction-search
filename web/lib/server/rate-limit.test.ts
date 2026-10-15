import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkLimit, rules, visitorId, type CounterStore } from './rate-limit';

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
