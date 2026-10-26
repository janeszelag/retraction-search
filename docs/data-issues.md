# Data issues and how the pipeline handles them

Status: summary as of 2026-10-14, plus upstream's format change of 2026-10-15, its return on 2026-10-19, and its second export in UTF-8 from 2026-10-22. Numbers are from the 2026-10-09 snapshot (upstream commit `bc5648dd`, 73,100 records) unless a line says otherwise. The rules come from [spec 001](specs/001-data-cleaning/spec.md) (cleaning) and [plan 002](specs/002-local-search/plan.md) (search). `npm run clean` writes a profile report (`profile.md`) with the current numbers for any snapshot.

This page covers problems in how the data is written down: formats, placeholders, spellings. What the data means, and why counts need care, is covered by the [data caveats](product-brief.md#data-caveats) in the product brief. Examples include selective coverage of expressions of concern, countries that cover every author, and approximate dates.

## How the pipeline treats a problem

- **Fix only what is clearly a formatting error or variant.** Different spellings of "we don't know" become one value, and a DOI written in capitals becomes lowercase. Institutions, publishers and author names aren't otherwise normalized (a non-goal in both specs).
- **Keep what Retraction Watch published.** Wherever the cleaning changes a value, the published text is kept in `original`, and record pages show it (spec 001 AC4, spec 002 AC22). Changes to whitespace alone are the exception: the profile report counts them instead (changed 2026-10-25).
- **Make every change visible.** The profile report counts each kind of change and lists the records that need a person to look at them.
- **Stop rather than serve wrong counts.** When an input breaks an assumption, the cleaning or the load stops with an error that says why. The site keeps serving the last good data.

## File format

| Issue | How it's handled |
|---|---|
| The header ends with a comma, so parsers see a 21st, always-empty column. The second export's header doesn't (see below). | Ignored. The column check allows either. |
| A column could go missing, be renamed, or appear with data in a future snapshot. | The cleaning stops, names the column and writes no output (spec 001 AC3). |
| Some files end with rows of 20 commas and nothing else. They aren't in the 2026-10-09 snapshot. Every daily file from 2026-08-18 to 2026-09-22 had them, 130 to 317 rows, and so did the monthly samples from 2026-02-13 (78) and 2026-06-12 to 2026-08-14 (192 to 279). None have appeared since 2026-09-23 (checked 2026-10-14, spec 003 spike S1). | Rows where every field is empty or only spaces are dropped before cleaning, and the profile report gives their number (spec 001 AC2, changed 2026-10-14). A row with any value at all is kept and goes through every check. The 2026-09-22 file cleans to 72,561 records, with 130 empty rows dropped. |
| The 2026-10-15 file (upstream commit `1dcf1a28`) came from a different export, and it lost text. It's in Windows-1252, not UTF-8: 35,954 bytes aren't valid UTF-8, such as `0x92` for ’ and `0xE9` for é. **Every character Windows-1252 can't hold became `?`.** The 2026-10-14 file had 334,843 such characters, and the new file has 334,857 more question marks. Most are Cyrillic (329,650), followed by symbols, Greek, Latin letters such as ł, ő and ğ, Chinese and Korean. At least 4,732 records lost characters in their title or journal alone. One journal, "Bulletin of New Medical Technologies (Вестник Новых Медицинских Технологий)", now reads "(??????? ????? ??????????? ??????????)". The export also changed formatting: line breaks inside quoted fields (173,235 lines for about 73,000 records, against one line per record before), dates written `M/D/YYYY 12:00:00 AM` (see Dates), missing PubMed IDs written `00000000` instead of `0`, list separators followed by a space, some double spaces in journal and publisher names, and no trailing comma in the header. Read with the right encoding, it has 73,253 records: 39 added and none removed, a normal day. Neither the commit nor the README mentions the change. The commit came from the same automated account as every other day. The 52 snapshots read in spike S1 of spec 003, every daily commit from 2026-08-18 to 2026-10-14 plus one a month back to October 2025, were all UTF-8 in the old format. The 2026-10-16 file was UTF-8 in the old format again. The 2026-10-19 (`a503965f`) and 2026-10-20 (`d7ebf06f`) files were Windows-1252 again, in the same export but with dates back in the `M/D/YYYY 0:00` form. The 2026-10-20 file has 35,958 bytes that aren't valid UTF-8 and 339,441 question marks, against 4,570 in the 2026-10-16 file. At least 5,535 of its records lost characters in their title, journal, publisher, institution or author. Every commit came from the same automated account at about 23:00 UTC, so nothing in the commits tells the two exports apart (checked 2026-10-21). | The update stops at the download, before anything reaches search, with an error saying the file isn't valid UTF-8 (spec 003 AC22, see "Checks that stop a run"). Search keeps the last snapshot that loaded. Each such file fails the run and comments on the open `daily-update` issue (#13 for the 2026-10-15 file, #24 for the 2026-10-19 and 2026-10-20 files). The next UTF-8 file loads and closes the issue, as the 2026-10-16 file did. The owner reported the change to Crossref's support on 2026-10-21. The export's formatting is handled since 2026-10-25 (next row), but the lost characters can't be recovered from the file, so loading it would put `?` in names and journals and could merge different journals that now read the same. The 2026-10-21 file (`f5596565`) stopped here too, with 35,965 bytes that aren't valid UTF-8. Found on the workflow's first run, 2026-10-16 02:37 UTC. |
| The 2026-10-22 (`13d54397`) and 2026-10-23 (`a987928a`) files come from the second export in UTF-8, and no text was lost: the 2026-10-23 file has 4,612 question marks, against 4,570 in the 2026-10-16 file, and its Cyrillic journal names are intact. Both match GitLab's SHA-256 and blob ID. They start with a UTF-8 byte-order mark (`EF BB BF`) and write values the way the 2026-10-15 file did: no trailing comma in the header, line breaks and repeated spaces (see List fields), `; ` between URLs, `00000000` for a missing PubMed ID (see Identifiers), and record 18930's dates in a second form (see Dates). DuckDB's parallel CSV reader reads the 2026-10-23 file, but stopped on the 2026-10-15 file converted to UTF-8, which has about as many lines. Two more differences turned up while loading it: record 34181's empty institution is written `None` in every second-export file (2026-10-15, 2026-10-21, 2026-10-22 and 2026-10-23), and record 69908's paper PubMed ID 69063 is written `00069063` (checked 2026-10-25). | Loaded since 2026-10-25 (spec 003 AC4 and AC23, spec 001 changes of 2026-10-25). The download accepts the byte-order mark and saves the file unchanged, the CSV is read on one thread, and the rules under Dates, Identifiers and List fields apply to both exports. The daily diff ignores how a value is written, so from the 2026-10-16 file to the 2026-10-23 file it counts 146 changed records instead of 62,489, and upstream can switch between the exports without stopping the run. Not handled yet: record 34181 gets an institution named "None", and both it and record 69908 count as changed in the diff. Record 69908's PubMed ID still cleans to 69063. |

## Dates

| Issue | How it's handled |
|---|---|
| Dates are text in the form `M/D/YYYY 0:00`. | They become real dates, each with a year for the year filters. A date that can't be parsed becomes empty and is listed in the profile report; none fail on this snapshot. |
| The 2026-10-15 file wrote every date as `M/D/YYYY 12:00:00 AM` (see File format). The second export's UTF-8 files write only record 18930's two dates that way, the 1753 paper and its 1756 notice. Upstream's issue tracker has reported this form for the same record since 2026-03-02 ([issue 2](https://gitlab.com/crossref/retraction-watch-data/-/issues/2), open on 2026-10-25). | Both forms parse (spec 001 AC6, changed 2026-10-25), and the diff treats a date written either way as the same date. A date in any other form still becomes empty and is listed in the profile report, and the cleaning still doesn't stop on it. |
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
| A missing PubMed ID is written as blank or `0`, and the second export writes `0` as `00000000` (34,799 notice and 33,810 paper IDs in the 2026-10-23 file). Real IDs aren't padded, except record 69908's paper ID (see File format). | Any value made only of zeros becomes empty (spec 001 AC8, changed 2026-10-25). The published text stays in `original`, so a record page shows `0` or `00000000` as the published value, depending on the export. The diff treats blank, `0` and `00000000` as the same. |

## List fields

Author, Institution, Country, Subject, Reason, ArticleType and URLS hold several values separated by semicolons.

| Issue | How it's handled |
|---|---|
| Subject, Reason and ArticleType always end with a semicolon. Title, Journal, the DOIs and Notes can contain semicolons but aren't lists. | Only the seven list fields are split. Entries are trimmed, empty entries are dropped and order is kept. For each field, a check confirms that the number of entries equals the number of items in the source text (spec 001 AC10). |
| "We don't know" is written several ways: "Unknown", "unknown", "unavailable", "Unavailable", "Not available", "Not Available". | In authors, institutions and countries, every spelling becomes "Unknown". 117 records list an "Unknown" author (2 rewritten from another spelling), 885 an "Unknown" institution (480 rewritten), and 958 an "Unknown" country (none rewritten). |
| The second export puts line breaks in Institution and Notes. In the 2026-10-23 file there are 98,315 in the institutions of 40,128 records, 95,419 of them right after a semicolon and 2,186 inside an entry, and more in the notes of 1,324 records. It also writes double spaces in 1,982 values (98 in the first export), such as 424 author fields and 242 journals, and tabs in 18 (6). | In titles, journals, publishers, notes and list entries, every run of spaces, tabs and line breaks becomes one space, and a line break never splits a list (spec 001 AC9 and AC10, changed 2026-10-25). About one in twenty line breaks inside an institution entry falls within one affiliation, as when "Lanzhou" ends one line and "University" starts the next, so splitting there would invent institutions. The profile report counts the values changed in each column: in the 2026-10-23 file, 40,224 institutions, 2,143 notes, 424 authors, 249 journals, 74 titles and 67 publishers. In the 2026-10-16 file, the same rule changes 97 institutions, 5 notes and 2 journals; 15 records show the difference on the site. These changes aren't kept in `original`, and the diff ignores them. |
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

**Download** (`npm run download`, and the update's first step) stops when:
- the file is empty, or doesn't start with the expected header. A UTF-8 byte-order mark before the header is allowed, and the file is saved with it (spec 003 AC23). The error writes invisible characters, such as the mark, as `\uXXXX`. Until 2026-10-25, the second export's mark stopped every run here, and the error showed the mark as nothing, so the header it quoted looked right (issue #24).
- its git blob ID differs from the one GitLab reports, so the download doesn't match GitLab's file
- it isn't valid UTF-8. The error gives the number of bytes that aren't valid UTF-8 and the line of the first one, and says the download matches GitLab's file (spec 003 AC22). The 2026-10-19 and 2026-10-20 files stop here (checked 2026-10-21).
- its SHA-256 differs from the one GitLab reports. GitLab computes that checksum on a copy it converts to UTF-8, and the conversion varies: for the 2026-10-15 file the copy was 35,978 bytes longer, and for the 2026-10-19 file it was the file with its 35,957 invalid bytes dropped. So for a file that isn't UTF-8 this check can never pass, which is why the UTF-8 check runs first. Until 2026-10-21, this check stopped those files with a "Checksum mismatch" error that read like a broken download.

**Cleaning** (`npm run clean`) stops when:
- the file isn't valid UTF-8 (DuckDB refuses to read it, as with the 2026-10-15 file)
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
