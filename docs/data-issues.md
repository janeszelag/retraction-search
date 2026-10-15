# Data issues and how the pipeline handles them

Status: summary as of 2026-10-14. Numbers are from the 2026-10-09 snapshot (upstream commit `bc5648dd`, 73,100 records) unless a line says otherwise. The rules come from [spec 001](specs/001-data-cleaning/spec.md) (cleaning) and [plan 002](specs/002-local-search/plan.md) (search). `npm run clean` writes a profile report (`profile.md`) with the current numbers for any snapshot.

This page covers problems in how the data is written down: formats, placeholders, spellings. What the data means, and why counts need care, is covered by the [data caveats](product-brief.md#data-caveats) in the product brief. Examples include selective coverage of expressions of concern, countries that cover every author, and approximate dates.

## How the pipeline treats a problem

- **Fix only what is clearly a formatting error or variant.** Different spellings of "we don't know" become one value, and a DOI written in capitals becomes lowercase. Institutions, publishers and author names aren't otherwise normalized (a non-goal in both specs).
- **Keep what Retraction Watch published.** Wherever the cleaning changes a value, the published text is kept in `original`, and record pages show it (spec 001 AC4, spec 002 AC22).
- **Make every change visible.** The profile report counts each kind of change and lists the records that need a person to look at them.
- **Stop rather than serve wrong counts.** When an input breaks an assumption, the cleaning or the load stops with an error that says why. The site keeps serving the last good data.

## File format

| Issue | How it's handled |
|---|---|
| The header ends with a comma, so parsers see a 21st, always-empty column. | Ignored. |
| A column could go missing, be renamed, or appear with data in a future snapshot. | The cleaning stops, names the column and writes no output (spec 001 AC3). |
| Some files end with rows of 20 commas and nothing else. They aren't in the 2026-10-09 snapshot. Every daily file from 2026-08-18 to 2026-09-22 had them, 130 to 317 rows, and so did the monthly samples from 2026-02-13 (78) and 2026-06-12 to 2026-08-14 (192 to 279). None have appeared since 2026-09-23 (checked 2026-10-14, spec 003 spike S1). | Rows where every field is empty or only spaces are dropped before cleaning, and the profile report gives their number (spec 001 AC2, changed 2026-10-14). A row with any value at all is kept and goes through every check. The 2026-09-22 file cleans to 72,561 records, with 130 empty rows dropped. |

## Dates

| Issue | How it's handled |
|---|---|
| Dates are text in the form `M/D/YYYY 0:00`. | They become real dates, each with a year for the year filters. A date that can't be parsed becomes empty and is listed in the profile report; none fail on this snapshot. |
| Dates go back to 1753 (a paper) and 1756 (its notice). Typesense has no date type. | Dates are stored as Unix seconds, negative before 1970. Spike S7 confirmed that sorting and year filters work for the 49 papers and 7 notices dated before 1970. |
| Six records, sections of one 1970 book, are dated 1 January 1970 for both paper and notice. Crossref stores that notice date as timestamp 0, so it's almost certainly a placeholder. | Kept as published, and listed in the profile report. |
| One record's notice is dated before its paper. | Kept as published, and listed in the profile report. |
| 1,960 records give the paper and the notice the same date. One known cause: when a publisher overwrote the article page with the notice, both get the same date. | Kept as published. The year filters say that dates are approximate below the year (spec 002 AC9). |

## Identifiers

| Issue | How it's handled |
|---|---|
| A missing DOI is written as blank, "unavailable" or "Unavailable". | Becomes empty. |
| The same DOI appears in different capitalizations, old-style DOIs contain percent-encoding (`%3C` for `<`), and some have surrounding spaces. | DOIs are trimmed, percent-decoded and lowercased, so an identifier lookup finds every record that has the DOI. |
| Two notice DOIs start with a stray "x" or "xx". Three chapters of one book share a notice, and the x's appear to keep each record's notice DOI unique. | The x's are removed, so all three chapters share the notice's real DOI. The published text stays in `original`, and the profile report lists DOIs whose text doesn't start with "10.". |
| A missing PubMed ID is written as blank or `0`. | Becomes empty. |

## List fields

Author, Institution, Country, Subject, Reason, ArticleType and URLS hold several values separated by semicolons.

| Issue | How it's handled |
|---|---|
| Subject, Reason and ArticleType always end with a semicolon. Title, Journal, the DOIs and Notes can contain semicolons but aren't lists. | Only the seven list fields are split. Entries are trimmed, empty entries are dropped and order is kept. For each field, a check confirms that the number of entries equals the number of items in the source text (spec 001 AC10). |
| "We don't know" is written several ways: "Unknown", "unknown", "unavailable", "Unavailable", "Not available", "Not Available". | In authors, institutions and countries, every spelling becomes "Unknown". 117 records list an "Unknown" author (2 rewritten from another spelling), 885 an "Unknown" institution (480 rewritten), and 958 an "Unknown" country (none rewritten). |
| Some records repeat an entry: 504 repeat an institution, 9 an author, and 1 a subject. | Kept as published. Filter counts count records, not entries, so repeats don't change them. Checks against DuckDB count distinct records for the same reason. |

## Subjects, revisions and editorial notices

| Issue | How it's handled |
|---|---|
| Each subject starts with a code, as in "(BLS) Biology - Cancer". Some names appear under two codes, such as Nutrition under BLS and HSC. | Each subject splits into its code and name, and keeps its code in the filter ("BLS: Nutrition"). A subject without a code would be listed in the profile report; there are none. |
| Revised versions of preprints, guidelines and reviews are separate records, marked "Revision" in their article types (279 records). | Flagged as revisions, and hidden by default, with an option to include them. |
| Seven notices list the journal's editorial staff as the author, written in different ways ("Editorial Staff PLoS One", "Frontiers Editorial Staff"). | Flagged, and available as a filter. |

## Names

Found while building search (spec 002, spikes S2 and S8). Typesense's exact filters ignore capitals and accents, and can't hold a backtick.

| Issue | How it's handled |
|---|---|
| Some journals and publishers are spelled in more than one way, differing only in capitals or accents (see the table below). Left alone, a journal listed with a count of 4 would show 62 records when selected. | The cleaning merges each group into its most common spelling, with ties going to the first spelling in sort order. That changed 10 journal records and 2 publisher records. The published spelling stays in `original`. The filters now have 8,771 journals and 1,717 publishers. |
| 1,945 author names fall into 967 groups that differ only in capitals or accents, such as "Maria Example" and "MARIA EXAMPLE". Others differ only in punctuation: a dropped hyphen, a non-breaking hyphen or a trailing comma. | Kept as published. Selecting an author name finds records listing it with any capitals, accents or punctuation, labeled as a name match, never as one person's work (spec 002 AC14). Punctuation is dropped, not read as a space, so "Ana Ma-Smith" matches "Ana Masmith" but not "Ana Ma Smith". |
| Six author names, in 8 records, contain a backtick. In three it sits between two letters, where an apostrophe would be; in the other three it's at the start or end of a word. | A backtick between two letters becomes an apostrophe (`'`, which author names use about twice as often as `’`). Any other backtick is removed. The published name stays in `original`. |
| 31 institution entries, in 25 records, also contain a backtick. | Kept as published. Institutions are only searched word by word, so a backtick doesn't break anything. |
| 69 journal names and 66 publisher names are longer than 255 bytes, mostly titles given in two languages. Typesense cuts filter values at 255 bytes. | Kept as published. The load stores the full name of each cut value, and the site shows the full name. |

Journal and publisher spellings merged on this snapshot:

| Kept spelling | Records | Other spellings (records) |
|---|---:|---|
| 2011 International Conference on Electric Information and Control Engineering | 57 | "…Electric information…" (4), "2011 international Conference…" (1) |
| The Journal of Urology | 28 | "The journal of Urology" (1) |
| medRxiv | 23 | "medrxiv" (1) |
| Applied Mathematical Modelling | 9 | "Applied Mathematical modelling" (1) |
| Neurotoxicology | 4 | "NeuroToxicology" (1) |
| Sadhana | 3 | "Sādhanā" (1) |
| Springer (publisher) | 5,210 | "springer" (2) |

A spelling that differs by a typo rather than by capitals, such as "Placenta" and "Placneta", stays a separate journal. Its count still matches its results, so it isn't merged.

## Links to Retraction Watch

| Issue | How it's handled |
|---|---|
| The same page is sometimes written with `http` and sometimes `https`, with or without a trailing slash. 62,461 links in 40,151 records give 4,432 distinct addresses as written, and 4,365 once those differences are ignored. | Each link gets a count of how many records list it, ignoring those two differences. A link written with and without "www." (one post), and site-search links that differ only in capitals (45 groups), are still counted separately. |
| One blog post can cover a batch of retractions: one post is linked from 10,855 records. | Results show how many records link to each post, so a post about a batch isn't read as a story about one paper (spec 002 AC18a). |
| 545 distinct links go to Retraction Watch pages that aren't posts, such as its list of retracted COVID-19 papers, its leaderboard and searches for a person's name. | Not decided yet: an open question in spec 002 is how to label them so they don't read as this site's own ranking or profile. |

## Checks that stop a run

**Cleaning** (`npm run clean`) stops when:
- a column is missing, renamed or unexpected
- the number of records differs from the number of source rows, a record ID repeats or is missing, or a record lacks exactly one notice type
- splitting a list field loses or invents entries

**Load** (`npm run load`) stops, and keeps the current data live, when:
- any document fails to import, or the number loaded differs from the number in the snapshot
- two values of a filter field differ only in capitals or accents, which the cleaning should have merged
- two journal or publisher names share their first 255 bytes, so Typesense would merge their counts
- a journal or publisher value that Typesense returns doesn't match the documents. This happened once in nine loads on 2026-10-13: right after an import, Typesense returned a publisher name with one letter missing. Spike S2 of spec 003 found the cause on 2026-10-15: a Typesense bug ([typesense/typesense#3071](https://github.com/typesense/typesense/issues/3071)) drops a letter from imported text in about one import in three. See decision record [004](decisions/004-typesense-import-escaping.md) for the fix.

## Out of scope

- Merging institutions, publishers or author names that are written differently, beyond the capitalization and backtick fixes above.
- Telling apart people who share a name, or joining one person's name variants. Author matches are name matches only.
- Correcting what Retraction Watch recorded, such as dates, reasons or countries. Problems with the data are reported to Retraction Watch; problems with this site go to the project's GitHub issues.
