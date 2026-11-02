# 006: Upstash Redis Free for the site-wide counters

Status: proposed, 2026-11-02, for the owner to accept with [spec 005](../specs/005-server-work/spec.md). Facts were checked on 2026-11-02.

## Context

- Crawlers took the site close to two of Vercel Hobby's allowances, and the firewall stops only the crawlers it can recognize. Spec 005 adds a site-wide ceiling on the pages and downloads the server produces.
- A ceiling needs one counter that all of the site's server instances share. Vercel runs server code on instances that don't share memory, so the count can't live in the site.
- Decision record [005](005-site-hosting.md) left the store to the rate-limit iteration, and listed the options checked on 2026-10-15. The site already has a Redis client (`@redis/client`) and counter code from spec 002.
- The project's cost rule: anything billed by usage needs a hard cap enforced by the provider, and a new hosted service needs a decision record with its worst-case month.

## Decision

**Upstash Redis Free, one database in `us-east-1`, on an account with no card.** The site's existing client connects with a `rediss://` address, kept in Vercel as a sensitive setting, for Production only.

The database holds a handful of counters, each one number under a key made of its kind and window. It holds no addresses, no queries and nothing about a visitor, and every key expires.

The site stays within the free plan by design:

- Each page costs one command (`INCRBY`), plus one `EXPIRE` when a window starts. It doesn't use `MULTI`, which would count at least two commands a page, plus possibly the wrapper.
- Once a ceiling is reached, an instance stops calling the store until the window ends, so a flood costs no more commands than an ordinary busy day.
- At the default ceilings, the most a month can use is about 240,000 of the 500,000 commands (plan 005).

If the store fails or refuses, the site serves as if the ceilings were off (spec 005 AC11), and the site check reports it (AC15).

## Checked facts (2026-11-02)

| Fact | Source |
|---|---|
| Free plan: 500,000 commands a month, 250 MB of data (its comparison table says 256 MB), 10 GB of bandwidth a month, 10,000 commands a second, one database | [Upstash Redis pricing](https://upstash.com/pricing/redis) |
| "Once you enter your credit card, your database will be upgraded to the pay-as-you-go plan" | Upstash Redis pricing, FAQ |
| Past its monthly limit a database answers `ERR max requests limit exceeded` | [Upstash troubleshooting](https://upstash.com/docs/redis/troubleshooting/max_requests_limit) |
| Each command in a pipeline or transaction is billed individually | [Upstash billing](https://upstash.com/docs/redis/overall/billing) |
| Free databases are archived after at least 30 days without use, with warning emails first | [Upstash FAQ](https://upstash.com/docs/redis/help/faq) |
| Railway's Redis template "does not ship with ssl enabled" | Checked for decision record 005 on 2026-10-15, not rechecked |
| Vercel's rate-limit SDK can count with one fixed key, which makes a rule "effectively global". Hobby allows one rate-limit rule, and windows of at most 10 minutes | [Rate limiting SDK](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting-sdk), [WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) |

Unverified: whether Upstash counts `MULTI` and `EXEC` themselves, which this design avoids. Upstash's Terms of Service give an older, shorter idle period of 1 week, which doesn't matter while the site gets traffic. Latency from `iad1` is unmeasured (spec 005's spike S3).

## Expected cost

| Piece | Worst-case month | At its limit |
|---|---|---|
| Upstash Redis Free | $0. With no card, it can't bill. | It refuses commands, and the ceilings stop working until the month ends. The site stays up. |

**The project's worst case is unchanged:** $50 a month for Railway, plus $15 a year for the domain.

## Alternatives

- **A count in each instance's memory.** No account and no store. It can't be a ceiling, though: the number of instances isn't fixed, and the count resets when one stops.
- **Vercel's rate-limit SDK with one fixed key.** No new provider. It would need Hobby's only rate-limit rule, which today limits each address before any code runs and is the only limit that stops requests from counting at all. The 10-minute window also leaves little room for a burst.
- **Redis on Railway.** Under the existing $50 cap, but with no TLS between Vercel and Railway, as decision record 005 found. It's another service to run, and it takes from the search server's budget.
- **Upstash pay-as-you-go with a budget.** A hard cap enforced by the provider, but it needs a card. The next step only if the free plan runs out.
- **Typesense as the store.** Already hosted, but the site's key can only search, and that's a rule worth keeping (spec 004 AC4).
- **No store, and no ceiling.** Caching and the firewall alone. The site stays exposed to any crawler the firewall can't recognize, which is the problem spec 005 is there to solve.

## Consequences

- There's a new account for the owner to keep, with no card on it.
- Spec 004 AC7's "the site needs no Redis" no longer holds. Its per-visitor limits stay off on the live site.
- A page that isn't cached makes one more network call before its search.
- Phase 5's per-visitor limits can use the same store. They'd need more commands, so that iteration should check the free plan's limit again.
