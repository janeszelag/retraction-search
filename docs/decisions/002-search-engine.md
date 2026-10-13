# 002: Typesense on Railway for search

Status: accepted, 2026-10-12

## Context

- Search runs on a server (spec 001): results show every field, institutions are searchable, and running a search server is a learning goal.
- Goal 4 needs search within a single field, with "any of", "all of" and exclusion, plus typo tolerance that can be reduced for a field.
- Natural-language filters are Phase 5, so an engine with them built in saves building that layer ourselves.
- Guardrails: filter counts must match the data, and the worst-case monthly bill must be known in advance (fixed costs, or usage billing with a hard cap).
- The data, from spec 001's size report on the 2026-10-09 snapshot: 73,100 documents and 110.8 MB of JSON. Of that, searchable text is 35.5 MB (17.2 MB of it institutions), filters 22.0 MB, identifiers 4.9 MB, and stored-only fields (`original`, `notes`, `urls`) 22.6 MB.

## Decision

**Engine: Typesense 30.2,** the current stable release, run from the official `typesense/typesense:30.2` container image. Version 31.0 is still in release candidates.

- Goal 4 maps directly onto Typesense's own features. Filters match any of several values (`country: [USA, UK]`), exclude values (`:!=`) and combine clauses with `&&` and `||`. The search box supports `-word` exclusion and quoted phrases. Typo tolerance can be set from 0 to 2 per field.
- Natural-language search is built in: it turns a sentence into a query and filters, and returns the generated filters, which the site can show as editable tags. Providers are chosen in Phase 5's own decision record.
- The schema indexes only the searchable and filter fields. Typesense keeps fields outside the schema on disk, not in memory, so `original`, `notes` and `urls` cost disk only.

**Host: Railway, Hobby plan,** with a volume for Typesense's data, a hard usage limit of $50 (the owner's maximum), and an email alert at $10 so rising usage shows up early.

**Keys and traffic:** browsers never talk to Typesense. Every search goes through the website's own server code (Next.js on Vercel), which holds a search-only key and limits how many searches each visitor can make. The admin key used to load data lives in Railway's settings and as an encrypted GitHub secret.

## Checked facts (2026-10-12)

| Fact | Source |
|---|---|
| RAM needed is about 2–3 times the size of the fields you search and filter on; unindexed fields are stored on disk and don't count toward RAM | Typesense system requirements |
| At least 2 vCPUs, and disk at least the size of the raw data, preferably SSD | Typesense system requirements |
| Filter-count sampling is off by default (`facet_sample_percent` 100); `max_facet_values` defaults to 10 | Typesense search API |
| No date type: dates are stored as Unix timestamps in `int64` fields | Typesense collections API |
| An alias points to a real collection, so data can be loaded into a new collection in the background and the alias switched to it, for reindexing without downtime | Typesense collection alias API |
| Hobby is $5 a month and includes $5 of usage; RAM $10 per GB-month, CPU $20 per vCPU-month, volumes $0.15 per GB-month, data transfer out $0.05 per GB; Hobby volumes up to 5 GB | Railway plans |
| The hard limit's minimum is $10. At the limit, Railway takes every service offline, and redeploys them automatically once the limit is raised. Email alerts can be set below it. | Railway usage limits |
| `typesense/typesense:30.2` released 2026-04-16; 31.0 is at release candidate 19 | Docker Hub |

## Expected cost

These are estimates, to confirm against the first invoice.

- **Memory:** the indexed fields come to about 62 MB (searchable text, filters and identifiers). At 2–3 times that, the index needs roughly 125–190 MB, plus whatever Typesense itself uses, which spec 002 measures. Half a gigabyte costs about $5 a month.
- **CPU:** Railway bills the CPU actually used, by the minute. An idle search server, one data load a day and light traffic should use little.
- **Disk:** under 1 GB, which is less than $0.15 a month.
- **Data transfer:** at roughly 20 KB per search, 100,000 searches move about 2 GB, or $0.10.

Expected total: around the $5 that Hobby includes. **Worst case: $50 a month.** The $5 plan fee covers the first $5 of usage, Railway emails at $10, and it stops the service once usage reaches the $50 limit. Past that point, a bug or a bot hammering the search costs downtime, not money.

## Alternatives considered

- **Meilisearch, self-hosted on Railway.** It fits the cost rule just as well. Typesense was chosen for its built-in natural-language filters and the per-field controls checked above. Meilisearch wasn't evaluated in depth.
- **Typesense Cloud or Meilisearch Cloud.** The managed versions bill by usage, and the project notes found no spending cap for either (not rechecked today). Without a cap they fail the cost rule.
- **A small VPS (Hetzner, DigitalOcean).** A fixed price, but data transfer beyond the allowance is billed with no cap (per the project notes), and there's more server administration. It could be a later learning project.
- **Browsers calling Typesense directly with a search-only key.** The simplest setup, but anyone could copy the key from the page and flood the server. Rejected to keep risk down, and because server-side Next.js code is a learning goal.
- **A SQL backend (DuckDB behind a small API).** Exact counts and Boolean search come easily, but there's no typo tolerance or built-in natural-language search. The owner preferred a search engine.
- **Search in the browser.** Ruled out in spec 001: every field in the results and searchable institutions would mean a large download, and a server is a learning goal.

## Consequences

- **Spec 002 must check, against the profile report's exact counts:**
  - that filter counts are exact, since the docs say sampling is off but never state outright that counts are exact
  - that dates before 1970, stored as negative timestamps, filter and sort correctly
  - that long filter lists, such as 1,718 publishers, show every value, since Typesense returns 10 by default
  - that typo tolerance doesn't mix up names like Toronto and Torino
- **Spec 002 runs the same container image locally,** so your Mac needs Docker (Docker Desktop or similar).
- **Spec 003 loads each day's documents into a new collection and then switches an alias to it,** so search never sees a half-loaded index. Memory briefly doubles during the switch, which costs little because RAM is billed by the minute.
- **If the limit is reached,** search stays offline until the next billing cycle or until the limit is raised. If the volume were ever lost, the next daily run rebuilds the index from the CSV.
- **Typesense still needs a public address** so Vercel can reach it, but requests without the secret key are refused.
- **A per-visitor rate limit needs somewhere to keep count,** because Vercel runs server code on many short-lived instances that don't share memory. Spec 002 picks an option that fits the cost rule.
- **Natural-language filters (Phase 5) need their own decision record** for the model provider and its hard spending cap.
