# 005: Vercel Hobby and a firewall rule for the first release

Status: accepted, 2026-10-17. Drafted 2026-10-15; on 2026-10-17 the site's own rate limits and analytics moved to later iterations. Changed 2026-10-27 with the owner's approval: the account has a card for the domain, and downloads get a firewall challenge (spec 004, AC8 and AC14).

## Context

- Phase 4 puts the site from spec 002 online, in front of the hosted search server from spec 003. The brief already names Vercel's Hobby plan for the site, "which pauses at its limits (to verify in Phase 4)".
- The site limits each visitor's searches and downloads (spec 002, AC28). It keeps its counters in Redis, because Vercel runs server code on many short-lived instances that don't share memory. Plan 002 picked Redis on Railway for production and left Phase 4 to confirm it.
- The brief's metrics need custom events: a result click, counted with the kinds of filters active at the time, without cookies or session tracking. The brief left the analytics tool to the launch spec.
- Guardrails: anything billed by usage needs a hard cap that the provider enforces, and the worst-case monthly bill must be known in advance. Keys stay on the server.
- The provider caps already bound the bill: Railway stops at $50, and Hobby doesn't bill usage. What rate limits add is uptime. Without them, one script could push Railway to its cap, which takes search offline, or use up a Vercel allowance, which can pause the site. Until the site is announced, that risk is small (owner, 2026-10-17).

## Decision

**Site: Vercel Hobby,** deployed from `main` with `web` as the root directory. Its server code runs in a single region, the one closest to the Railway search server. Hobby doesn't bill usage: past a limit, Vercel pauses the feature instead. The account had no payment method until 2026-10-27, when buying the domain added a card. The card pays for the domain only.

**Limits in the first release: one Vercel firewall rate-limit rule per IP address.** It needs no code, account or store, and stops a flood before any server code runs. The site's own per-visitor limits (spec 002, AC28) are switched off on the live site, so the first release needs no Redis. Added 2026-10-27: a second firewall rule, not a rate limit, challenges every download request with Vercel's browser check, so a script can't fetch the full file in a loop (spec 004, AC14).

**Later iterations, each with its own decision when it starts:**

- **The site's own rate limits,** with a hosted store. Needed before Phase 5, since the brief requires the site's own rate limit in front of any LLM call. Also worth doing if the firewall rule turns out too blunt, or downloads start using up Vercel's allowances.
- **Analytics,** starting with visits and downloads, then the brief's success metrics. The brief's targets need four weeks of data, so this comes before the announcement or soon after it.

The facts and options below were checked for those iterations as well, so they don't need checking from scratch.

## Checked facts (2026-10-15, plus Observability on 2026-10-17)

| Fact | Source |
|---|---|
| Hobby is free, and restricted to "non-commercial, personal use only" | Vercel Hobby plan, fair use guidelines |
| Hobby includes each month: 1,000,000 function invocations, 4 CPU-hours of active CPU, 360 GB-hours of provisioned memory, 100 GB of fast data transfer, 10 GB of fast origin transfer and 1,000,000 CDN requests | Vercel Hobby plan |
| "In most cases" a Hobby account that goes over a limit can't use that feature again until 30 days have passed. Hobby has no billing cycle and no spend management. | Vercel Hobby plan |
| Hobby keeps runtime logs for 1 hour | Vercel Hobby plan |
| On Hobby, functions run in one region. New projects default to Washington, D.C. (`iad1`), which can be changed in the project's settings or `vercel.json` | Vercel function regions |
| Vercel overwrites `X-Forwarded-For` with the client's public address and doesn't forward addresses from other proxies, "to prevent IP spoofing". `X-Real-IP` holds the same value. | Vercel request headers |
| Firewall rate limiting is on every plan. Hobby gets 1 rule per project, counted by IP address or JA4 digest, with a fixed window of 10 seconds to 10 minutes and 1,000,000 allowed requests included. Hobby can have up to 3 custom firewall rules in all. | Vercel WAF rate limiting |
| `@vercel/firewall` lets server code ask a firewall rate-limit rule whether a request is over its limit, so the site can answer with its own page. The docs don't say whether it works on Hobby. | Vercel Rate Limiting SDK |
| Vercel Authentication can protect preview and production deployments on Hobby | Vercel Hobby plan |
| Web Analytics on Hobby: 50,000 events a month, page views only (no custom events), 1 month of reports. Collection pauses at the limit. | Vercel Web Analytics pricing |
| Observability is on every plan, but Hobby keeps its data for 12 hours, with no breakdown by path | Vercel Observability Plus, limitations |
| Railway's Redis template "does not ship with ssl enabled" (Railway staff, 2025-07-25). Its docs don't mention encryption. Access from outside Railway goes through a TCP proxy, billed as egress. | Railway Station forum, Railway Redis docs |
| Upstash Free: 250 MB of data, 500,000 commands a month, 10 GB of bandwidth a month. Entering a card upgrades the database to pay-as-you-go. | Upstash Redis pricing |
| A database over its monthly request limit answers `ERR max requests limit exceeded` | Upstash troubleshooting |
| "TLS is always enabled on Upstash Redis databases" | Upstash security |
| Pay-as-you-go costs $0.20 per 100,000 commands. With a monthly budget set, the database is rate limited at the budget and "your total cost will not exceed the chosen budget" | Upstash Redis pricing |
| Umami Cloud Hobby: free, 100,000 events a month, 1 website, 6 months of data. Custom events and properties are listed, and it uses no cookies. The page doesn't say what happens to a Hobby account over the limit. | Umami pricing |

Checked again 2026-10-27:

| Fact | Source |
|---|---|
| "In most cases, if you exceed your usage limits on the Hobby plan, you will have to wait until 30 days have passed before you can use the feature again." The page lists no usage prices for Hobby, and no longer mentions billing cycles. | Vercel Hobby plan |
| "Hobby projects can have one WAF Rate Limiting rule within their total of 3 custom firewall rules." The counting window is 10 seconds to 10 minutes. | Vercel WAF rate limiting |
| A custom rule can log, deny, challenge, bypass or redirect. A challenged client that passes the check goes on to the remaining rules. Persistent actions, which block a client for a while after a challenge or denial, are on Pro and Enterprise only. | Vercel WAF custom rules, rule configuration |

Unverified: whether anything other than an explicit purchase or upgrade can charge the card on a Hobby account, such as an add-on or a Marketplace integration. Whether Upstash counts `MULTI` and `EXEC` as commands, and how many connections its free plan allows. Plausible's own pricing page didn't load, and third-party listings give $9 a month for 10,000 page views.

## Expected cost

| Piece | Worst case a month | What happens at the limit |
|---|---|---|
| Typesense on Railway (decision record 002) | $50 | Railway takes the service offline. Search is down, and the site says so (spec 002, AC29). |
| Site on Vercel Hobby, with its firewall rule | $0 | Vercel pauses the feature over its limit, possibly for up to 30 days. |
| Domain www.retraction-search.com, bought through Vercel on 2026-10-27 | $15 a year (owner, 2026-10-27), charged to the card | It renews each year on the card unless the owner turns renewal off. If it lapses, the site stays at its `vercel.app` address. |

**Worst case: $50 a month,** the same as before this phase, plus $15 a year for the domain. The site adds Railway egress: each search returns about 20 KB from Typesense, so 100,000 searches cost about $0.10 (decision record 002).

The Hobby allowance most likely to run out first is 10 GB of fast origin transfer, the traffic between Vercel's functions and its CDN. A results page of about 50 KB would allow roughly 200,000 dynamic pages a month. Downloads weigh more: a file with every record could be tens of megabytes, so a few hundred of them might use the allowance up (estimate). Spike S1 in plan 004 measures both.

## Options for the later iterations

**The site's own rate limits:**

- **Upstash Redis Free.** TLS, no card, so no bill. Past 500,000 commands in a month it refuses commands, and the site serves searches without its own limits (spec 002, AC29). The existing code needs only a `rediss://` address.
- **Upstash pay-as-you-go with a budget cap.** A hard cap enforced by the provider, so it meets the cost rule, but it needs a card. The next step if the free plan runs out.
- **`@vercel/firewall`.** No store or new account, and the site keeps its own notice. It shares Hobby's single rate-limit rule, so searches and downloads would get the same limit and window. Hobby support and local behavior are unverified.
- **Redis on Railway** (plan 002's choice). Under the same $50 cap, but without TLS the Redis password and counters would cross the internet unencrypted between Vercel and Railway. A TLS proxy in front of it would fix that, at the cost of another service to run.
- **Counters in each instance's memory.** No store, but Vercel's instances don't share memory, so the limit multiplies when traffic spreads over more instances, which is when it's needed.

**Analytics:**

- **Vercel Web Analytics.** Counts visits as page views with one component and no new account. On Hobby it can't count downloads or result clicks, which aren't page views, and it keeps one month of reports.
- **First-party counters in Redis.** Daily totals for the brief's metrics and for downloads, kept by the site's server code, with no cookies or addresses. Fits best if the rate-limit iteration already adds Redis. Needs a beacon for clicks on links that leave the site, and a report command.
- **Umami Cloud Hobby.** Free, with custom events and a dashboard. It adds a third-party script to every page, and sends each visit to another service. Its behavior over the free limit is unverified.
- **Plausible.** Paid, with prices unverified. Unclear whether the cheapest plan records the filter details a click needs.
- **Umami, self-hosted on Railway.** Stays under the $50 cap, but adds a Postgres database and an app to run, and uses more of the cap.
- **Vercel's Observability.** Already there, with no setup, but Hobby keeps 12 hours of data, so it can't show a week.

## Consequences

- Spec 002's per-visitor limits (AC28) are off on the live site until the rate-limit iteration. Locally they stay on, with their tests. `CLAUDE.md`'s hard constraint now reads that each visitor's requests are rate-limited, which the firewall rule does.
- The firewall rule answers with Vercel's plain 429 page, not spec 002's notice with the time to try again. It can't limit downloads separately, since Hobby allows one rule with a window of at most 10 minutes. Downloads get a challenge instead (2026-10-27), which stops scripts that can't pass Vercel's browser check, but not one that drives a real browser.
- The owner opens one new account, on Vercel, with no payment method. Since 2026-10-27 it has a card, for the domain. Upgrading to Pro or adding a paid feature is then a click away, so `CLAUDE.md`'s rule applies: no paid service without a decision record giving its worst-case month.
- Until the analytics iteration, the site keeps no count of visits or downloads.
- If a Vercel allowance runs out, the site may be down for up to 30 days. The firewall rule makes that less likely. Moving to Pro would need a new decision record, since Pro bills by usage.
- With only an hour of runtime logs, Vercel's logs can't show past problems. Monitoring the site needs its own scheduled check (spec 004).
- Plan 002's "Production store: Redis on Railway" no longer holds. The rate-limit iteration picks the store.
