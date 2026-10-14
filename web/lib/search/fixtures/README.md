# Recorded Typesense responses

Responses from Typesense 30.2 with the 2026-10-09 snapshot loaded, recorded on 2026-10-13 for the search tests in `lib/server/search.test.ts`. Each file holds the URL query, the typo setting and the `multi_search` results that `toTypesense` asked for. `meta.json` is the meta document the load wrote.

Before saving, every author name was replaced with a made-up one (such as "Maria Example"), except the placeholder "Unknown". Notes and the author text in `original` were removed, and links were replaced with example addresses. Titles, journals, publishers and institutions are as Retraction Watch published them. The data is CC0: the Retraction Watch Database, distributed by Crossref.

| File | Query |
|---|---|
| `default.json` | The default view |
| `text.json` | `q=cancer unknown`, which matches titles and the author placeholder |
| `close-spellings-first.json`, `close-spellings-second.json` | `q=iraq` with the country Serbia, where only close spellings match, with typos as usual and then on for every search |
| `journals-selected.json` | Two selected journals, one with a name longer than 255 bytes and one that doesn't exist, and one excluded journal |
