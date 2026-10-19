// Checks a visitor's rate limit (spec 002 AC28, AC29). Server-only: it reads
// the visitor's address and the hashing salt, which never reach a browser.
//
// A counter in Redis per visitor and window. If Redis can't be reached, or
// answers slowly, the request goes ahead without a limit and the failure is
// logged, so a counter outage doesn't take search down with it.
//
// RATE_LIMITS=off turns the limits off without Redis (spec 004 AC7). The live
// site uses it while a Vercel firewall rule limits each visitor instead.
import 'server-only';
import { createHash } from 'node:crypto';
import { createClient } from '@redis/client';
import { headers } from 'next/headers';
import { DEFAULT_RULES, judge, windowOf, type LimitCheck, type LimitKind, type LimitRule } from '../rate-limit';

// How long a page waits for its count before going ahead without one.
const TIMEOUT_MS = 500;

export interface CounterStore {
  // Adds one to the counter and returns the new count. A new counter expires after ttlSeconds.
  increment(key: string, ttlSeconds: number): Promise<number>;
}

// The limits, which tests can lower through the environment (RATE_LIMIT_SEARCHES, RATE_LIMIT_DOWNLOADS).
export function rules(env: Record<string, string | undefined> = process.env): Record<LimitKind, LimitRule> {
  const max = (value: string | undefined, fallback: number) => (value && /^\d+$/.test(value) ? Number(value) : fallback);
  return {
    searches: { ...DEFAULT_RULES.searches, max: max(env.RATE_LIMIT_SEARCHES, DEFAULT_RULES.searches.max) },
    downloads: { ...DEFAULT_RULES.downloads, max: max(env.RATE_LIMIT_DOWNLOADS, DEFAULT_RULES.downloads.max) },
  };
}

// A visitor is a salted hash of the first address in x-forwarded-for, so the
// counters never hold an address, and no cookie is needed. Without the header
// (a request that didn't come through a proxy) every such visitor shares one counter.
export function visitorId(forwardedFor: string | null, salt: string): string {
  const address = forwardedFor?.split(',')[0]?.trim() || 'unknown';
  return createHash('sha256').update(`${salt}\n${address}`).digest('hex').slice(0, 32);
}

// Whether RATE_LIMITS=off has turned the limits off.
export function limitsOff(env: Record<string, string | undefined> = process.env): boolean {
  return env.RATE_LIMITS === 'off';
}

// State that belongs to the server, not to this module. Next.js gives the
// pages and each route handler their own copy of the module (seen with
// RATE_LIMITS=off, which logged once per copy), and in development it
// reloads changed modules, so the Redis store and the log flag live on
// globalThis.
const shared = globalThis as typeof globalThis & {
  rateLimitStore?: { url: string; store: CounterStore };
  rateLimitsOffLogged?: boolean;
};

let lastLogged = 0;
let outage = false;

// At most once a minute, so an outage doesn't flood the log.
function logOutage(error: unknown) {
  outage = true;
  const now = Date.now();
  if (now - lastLogged > 60_000) {
    lastLogged = now;
    console.error(`Rate limits are off: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function redisStore(url: string): CounterStore {
  const client = createClient({
    url,
    // Fail at once while disconnected, instead of queueing until Redis is back.
    disableOfflineQueue: true,
    socket: { connectTimeout: TIMEOUT_MS, reconnectStrategy: (retries) => Math.min(250 * 2 ** retries, 10_000) },
  });
  // Settles once the first attempt to connect has succeeded or failed.
  const firstAttempt = new Promise<void>((resolve) => {
    client.once('ready', resolve);
    client.once('error', () => resolve());
  });
  // Without a listener, a lost connection would crash the server.
  client.on('error', logOutage);
  client.on('ready', () => {
    if (outage) {
      outage = false;
      lastLogged = 0;
      console.info('Rate limits are back on: Redis is reachable again.');
    }
  });
  client.connect().catch(() => {});

  return {
    async increment(key, ttlSeconds) {
      if (!client.isReady) {
        await firstAttempt;
      }
      if (!client.isReady) {
        throw new Error(`Redis can't be reached at ${new URL(url).host}.`);
      }
      // NX: only a new counter gets an expiry, so later requests don't extend it.
      const [count] = await client.multi().incr(key).expire(key, ttlSeconds, 'NX').exec();
      return Number(count);
    },
  };
}

// One connection per server.
function defaultStore(): CounterStore {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL is not set (see .env.example).');
  }
  if (shared.rateLimitStore?.url !== url) {
    shared.rateLimitStore = { url, store: redisStore(url) };
  }
  return shared.rateLimitStore.store;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis didn't answer in ${ms} ms.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

interface Options {
  store?: CounterStore;
  forwardedFor?: string | null;
  now?: number;
}

// Counts this request toward the visitor's limit, and says whether it's over.
export async function checkLimit(kind: LimitKind, options: Options = {}): Promise<LimitCheck> {
  if (limitsOff()) {
    // Once per server, since each request checks.
    if (!shared.rateLimitsOffLogged) {
      shared.rateLimitsOffLogged = true;
      console.info('Rate limits are off (RATE_LIMITS=off).');
    }
    return { status: 'ok' };
  }
  try {
    const salt = process.env.VISITOR_HASH_SALT;
    if (!salt) {
      throw new Error('VISITOR_HASH_SALT is not set (see .env.example).');
    }
    const rule = rules()[kind];
    const now = options.now ?? Date.now();
    const forwardedFor = options.forwardedFor !== undefined ? options.forwardedFor : (await headers()).get('x-forwarded-for');
    const key = `limit:${kind}:${visitorId(forwardedFor, salt)}:${windowOf(now, rule).index}`;
    const count = await withTimeout((options.store ?? defaultStore()).increment(key, rule.windowSeconds), TIMEOUT_MS);
    return judge(count, rule, now);
  } catch (error) {
    logOutage(error);
    return { status: 'ok' };
  }
}

// A route handler's HTTP 429, with the limit, so the page can say what it is.
export function limitedResponse(check: Extract<LimitCheck, { status: 'limited' }>, error: string): Response {
  return Response.json(
    { error, retryAfter: check.retryAfter, max: check.rule.max, windowSeconds: check.rule.windowSeconds },
    { status: 429, headers: { 'Retry-After': String(check.retryAfter), 'Cache-Control': 'no-store' } },
  );
}
