# 004: Escape text sent to Typesense, and check what it stored

Status: accepted, 2026-10-15

## Context

- **What goes wrong:** Typesense 30.2 sometimes stores a name with one letter missing, and still reports that the import succeeded. In spike S2 of [plan 003](../specs/003-pipeline/plan.md#spikes-first), a publisher name containing "ответственностью" was stored as "ответственносью". Nothing in Typesense's response said anything had changed.
- **Why it happens:** Typesense reads an import request in slices of 196,605 bytes. Plain English letters, digits and ordinary punctuation take one byte each. Other characters take two to four: accented letters (é, ü, ñ), other alphabets (Cyrillic, Greek, Chinese) and symbols such as the en dash (–), curly quotes and °. When a slice ends between the bytes of one character, Typesense drops that character. The bug is open as [typesense/typesense#3071](https://github.com/typesense/typesense/issues/3071).
- **Which text it can hit:** any text with a character outside plain English typing: titles, author names, institutions, journals, publishers and notes. Text in plain English characters can't be damaged.
- **How often:** spike S2 imported the 2026-10-09 snapshot (73,100 records) into the local Typesense 70 times.
  - Sent as the load sends it now, 6 of 20 imports were damaged.
  - A damaged import had one or two damaged names, 7 in all: 4 author names, 2 publishers and 1 journal. Each was missing exactly one letter, Cyrillic in 6 cases and an "é" in one.
- **Why it matters:** a misspelled author name no longer matches the other records with that name. A misspelled journal or publisher shows up as an extra filter value with one record. The site's promise is to show what Retraction Watch recorded.
- **What the current check catches:** the load's facet-value check (plan 002) reads only journal and publisher values. It stopped 4 of 30 imports in S2, but it sees only about half of the damage: 3 of the 6 damaged imports above had damage only in author names, which it doesn't read.
- **A fix in Typesense is on the way, but not here yet:** [typesense/typesense#3109](https://github.com/typesense/typesense/pull/3109), opened 2026-10-12, says it fixes the bug. On 2026-10-15 it had no reviews and wasn't merged. Once merged, it still has to ship in a release, and moving off 30.2 is a change to decision record [002](002-search-engine.md).

## Decision

1. **Send every non-ASCII character as an escape code.** Before each import request, the load writes every character outside plain ASCII as a JSON escape, for example `é` as `é`. JSON defines the two as the same text, so Typesense stores `é` and the site shows `é`. The request is then made only of one-byte characters, so a slice can't end inside one.
2. **Check what Typesense stored.** After importing, the load exports the new collection and compares every field of every document with the cleaned file. Any difference stops the load before search switches to the new data.
3. **Retry once.** When that check fails, the daily update imports again once and reports the retry ([spec 003](../specs/003-pipeline/spec.md), AC9). A second failure fails the run, and search keeps serving the previous data.

`npm run load` and `npm run update` share the import code, so both do this.

## Checked facts (2026-10-15)

| Fact | Source |
|---|---|
| Issue 3071, "documents/import silently drops a multibyte UTF-8 character from a stored string in large request bodies", opened 2026-09-23, is open. Its reporters see the bug on Typesense 29.0, 30.1, 30.2 and the 31.0 release candidates 18 and 19. | [typesense/typesense#3071](https://github.com/typesense/typesense/issues/3071) |
| The slice size is `ACTIVE_STREAM_WINDOW_SIZE = 196605` | `include/http_server.h`, line 127, tag v30.2 |
| Each slice is turned into text with `error_handler_t::ignore`, which drops invalid UTF-8 without an error | `include/http_data.h`, line 470, tag v30.2 |
| PR 3109, "Preserve UTF-8 characters across streamed import chunks", says it fixes issue 3071. It's open, with no reviews. | [typesense/typesense#3109](https://github.com/typesense/typesense/pull/3109) |
| Escaped requests: 0 damaged imports out of 20. Unescaped: 6 out of 20. Escaping makes the upload 1.3% bigger (112.7 MB to 114.2 MB), and the median import time went from 6.2 s to 6.4 s. An export of the whole collection took 3 s locally. | Spike S2, [plan 003](../specs/003-pipeline/plan.md#spikes-first) |
| Railway charges $0.05 per GB of outgoing data (checked 2026-10-14) | [Plan 003](../specs/003-pipeline/plan.md#hosted-search-server-ac16-ac17-ac19), Railway facts |

## Alternatives considered

- **Escaping only, keeping the facet-value check as the only check.** This saves one export per load. Rejected: if escaping ever stopped working, for example after a Typesense upgrade, damage in titles and author names would go unseen again. The full check also catches any other bug that changes stored text.
- **Smaller import requests, each under one slice.** The issue's reporters saw no damage in requests under about 190 KB. That's about 600 requests per load instead of 15, slow over the internet to Railway, and it relies on a slice size that Typesense doesn't document.
- **Keeping plan 002's facet-value check and retrying when it fails.** Rejected: it misses about half of the damage.
- **Waiting for a Typesense release with the fix.** Rejected for now: PR 3109 isn't merged, there's no release date, and the daily pipeline needs correct loads now.

## Consequences

- **Cost:**
  - The upload is 1.3% bigger, with no measurable change in import time.
  - One export of about 113 MB per load. On Railway, one load a day comes to about 3.4 GB of outgoing data a month, about $0.17, which is within decision record 002's estimate. The second daily run usually finds the server up to date and loads nothing.
- **Time:** the export took 3 s locally. From GitHub's runner to Railway it will take longer, depending on the connection, and spec 003's runs measure it.
- **Once Typesense releases a fix:** the escaping is harmless and can stay, and the check stays. Upgrading Typesense is its own change to decision record 002.
- **Data loaded before this decision:** the collection the local site served on 2026-10-15 matched the cleaned file exactly. The site isn't public yet, so no visitor has seen damaged text.
