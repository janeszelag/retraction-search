# Test fixtures

`sample.csv` holds 37 real rows from the 2026-10-09 snapshot (upstream commit `bc5648dd`). They were copied line for line, so they keep the source file's exact format, including the header's trailing comma. The data is CC0: the Retraction Watch database, distributed by Crossref.

| Record ID | Why it's here |
|---|---|
| 1 | Institution without a trailing semicolon |
| 2 | Real PubMed IDs for both the paper and the notice |
| 4 | Several URLs |
| 6 | Paywalled: Yes |
| 10 | Several countries |
| 12 | Notice type: Correction |
| 17 | Paper DOI written "unavailable" |
| 18 | Notice type: Expression of concern |
| 35 | Subject "(BLS) Nutrition", a name that also appears under HSC |
| 96 | Paper DOI and notice DOI both blank |
| 102 | Paper and notice share a date |
| 148 | DOI ending in a plus sign |
| 241 | Paper DOI written "Unavailable" |
| 333 | Notice type: Reinstatement |
| 698 | Old-style DOI with a semicolon and percent-encoding |
| 859 | Paywalled: Unknown |
| 1086 | PubMed IDs of `0` |
| 1134 | Country "Unknown", and institution written "unavailable" |
| 1511 | Title containing a semicolon |
| 3804 | Revised version ("Revision" in article types) |
| 4952 | PubMed IDs blank |
| 9052 | A real institution followed by the placeholder "Unavailable" |
| 12419, 22992 | The same paper DOI written in two capitalizations |
| 18930 | The earliest dates: paper 1753, notice 1756 |
| 28020 | Journal name containing a semicolon |
| 34181 | Empty institution |
| 34394 | Institution written "Not available" |
| 35062 | Author written "unknown" and institution written "Unavailable" |
| 41581 | 88 authors |
| 43131 | Paper and notice dated 1 January 1970 |
| 69326 | Notes containing semicolons ("HTML overwrite; …") |
| 69493 | "Editorial Staff" author written "Editorial Staff PLoS One" |
| 69833 | "Editorial Staff" author written "Frontiers Editorial Staff" |
| 70689 | Notice DOI starting with a stray "x" (the clean form is shared with record 70687) |
| 70690 | Notice DOI starting with a stray "xx" |
| 73705 | Notice dated before the paper |

Every row also covers the common cases. Subject, Reason and ArticleType always end with a semicolon, and most rows are retractions.

The other files are built from `sample.csv`:

| File | What it tests |
|---|---|
| `missing-column.csv` | The Journal column is missing |
| `renamed-column.csv` | Reason is renamed to Reasons |
| `extra-column.csv` | An unexpected column, Extra, contains data |
| `subject-without-code.csv` | One synthetic row (record ID 900000001) whose first subject has no category code |
| `empty-rows.csv` | `sample.csv` followed by three rows of 20 commas and nothing else, as some upstream files end (spec 001 AC2) |
| `sample-next.csv` | `sample.csv` as a next snapshot, for the diff (spec 003): record 102 removed, synthetic records 900000301 and 900000302 added (copies of record 2), a reason added to record 6, record 18 changed from an expression of concern to a retraction, one of record 4's two URLs removed, an institution added to record 34181, and record 69326's notes emptied. It has no trailing comma in the header. |
| `windows-1252.csv` | `sample.csv` in Windows-1252, as upstream wrote the files of 2026-10-15, 2026-10-19 and 2026-10-20. Characters Windows-1252 can't hold become `?`, as upstream's did: here, one combining accent. It has 47 bytes that aren't valid UTF-8, the first on line 3 (spec 003 AC22). |
| `second-export.csv` | `sample.csv` as upstream's second export writes it in UTF-8, as in the files of 2026-10-22 and 2026-10-23 (spec 003 AC4 and AC23, spec 001 changes of 2026-10-25): a byte-order mark, no trailing comma in the header, a line break after each semicolon between institutions, line breaks inside record 4952's institution entry where the first export has spaces, `; ` between URLs, a double space in record 1's journal and in one of record 2's authors, a tab in record 1's title, `00000000` for every PubMed ID written `0`, record 18930's dates written `M/D/YYYY 12:00:00 AM`, two line breaks in record 69326's notes, and record 34181's empty institution written `None` |
| `names.csv` | Six synthetic rows (record IDs 900000101 to 900000106) with made-up names: author names with backticks, journal spellings that differ only in capitals or an accent, and a tie between two publisher spellings |

## Rebuilding

Run these from the repository root, after `npm run download -- --commit bc5648dd`:

```bash
IDS="1 2 4 6 10 12 17 18 35 96 102 148 241 333 698 859 1086 1134 1511 3804 4952 9052 12419 18930 22992 28020 34181 34394 35062 41581 43131 69326 69493 69833 70689 70690 73705"
awk -F, -v ids="$IDS" 'BEGIN { n = split(ids, a, " "); for (i = 1; i <= n; i++) keep[a[i]] = 1 } NR == 1 || ($1 in keep)' \
  data/raw/retraction_watch-2026-10-09-bc5648dd.csv > pipeline/test/fixtures/sample.csv
{ cat pipeline/test/fixtures/sample.csv; for i in 1 2 3; do printf ',,,,,,,,,,,,,,,,,,,,\n'; done; } > pipeline/test/fixtures/empty-rows.csv
```

`windows-1252.csv` writes out Windows-1252's characters for bytes 0x80 to 0x9F, because Node 22's `TextDecoder("windows-1252")` decodes that range as ISO-8859-1 and would turn ’ into `?`:

```bash
node -e '
const fs = require("node:fs");
const high = "€\x81‚ƒ„…†‡ˆ‰Š‹Œ\x8DŽ\x8F\x90‘’“”•–—˜™š›œ\x9DžŸ";
const byteOf = new Map([...Array(256).keys()].map((b) => [b >= 0x80 && b < 0xa0 ? high[b - 0x80] : String.fromCharCode(b), b]));
const text = fs.readFileSync(process.argv[1], "utf8");
fs.writeFileSync(process.argv[2], Uint8Array.from([...text], (ch) => byteOf.get(ch) ?? 0x3f));
' pipeline/test/fixtures/sample.csv pipeline/test/fixtures/windows-1252.csv
```

```sql
CREATE TABLE s AS SELECT * EXCLUDE (column20) FROM read_csv('pipeline/test/fixtures/sample.csv', all_varchar = true, header = true);
COPY (SELECT * EXCLUDE (Journal) FROM s ORDER BY CAST("Record ID" AS INTEGER) LIMIT 3) TO 'pipeline/test/fixtures/missing-column.csv' (HEADER);
COPY (SELECT * RENAME (Reason AS Reasons) FROM s ORDER BY CAST("Record ID" AS INTEGER) LIMIT 3) TO 'pipeline/test/fixtures/renamed-column.csv' (HEADER);
COPY (SELECT *, 'unexpected value' AS Extra FROM s ORDER BY CAST("Record ID" AS INTEGER) LIMIT 3) TO 'pipeline/test/fixtures/extra-column.csv' (HEADER);
COPY (SELECT * REPLACE ('900000001' AS "Record ID", 'Synthetic row: a subject without a code' AS Title, 'No code here;(HSC) Medicine - Surgery;' AS Subject) FROM s WHERE "Record ID" = '2') TO 'pipeline/test/fixtures/subject-without-code.csv' (HEADER);
CREATE TABLE r AS SELECT * FROM (VALUES
  ('900000101', 'Synthetic Journal of Examples', 'Example Press', 'Maria O`Example;Jun Sample`;`Ana Placeholder'),
  ('900000102', 'Synthetic journal of examples', 'example press', 'Maria Example'),
  ('900000103', 'Synthetic Journal of Examples', 'Example Press', 'Jun Sample'),
  ('900000104', 'Synthétic Journal of Examples', 'Example Press', 'Ana Placeholder'),
  ('900000105', 'Another Example Journal', 'tie press', 'Maria Example'),
  ('900000106', 'Another Example Journal', 'Tie Press', 'Jun Sample')
) AS t(id, journal, publisher, author);
COPY (
  SELECT s.* REPLACE (r.id AS "Record ID", 'Synthetic row: name cleaning' AS Title, r.journal AS Journal, r.publisher AS Publisher, r.author AS Author)
  FROM s, r WHERE s."Record ID" = '2' ORDER BY r.id
) TO 'pipeline/test/fixtures/names.csv' (HEADER);
COPY (
  SELECT * FROM (
    SELECT * REPLACE (
      CASE "Record ID" WHEN '6' THEN 'Concerns/Issues about Data;Results Not Reproducible;' ELSE Reason END AS Reason,
      CASE "Record ID" WHEN '18' THEN 'Retraction' ELSE RetractionNature END AS RetractionNature,
      CASE "Record ID" WHEN '4' THEN split_part(URLS, ';', 1) ELSE URLS END AS URLS,
      CASE "Record ID" WHEN '34181' THEN 'Example University, Example City, Exampleland' ELSE Institution END AS Institution,
      CASE "Record ID" WHEN '69326' THEN NULL ELSE Notes END AS Notes
    ) FROM s WHERE "Record ID" <> '102'
    UNION ALL
    SELECT s.* REPLACE (n.id AS "Record ID", 'Synthetic row: added in the next snapshot' AS Title)
    FROM s, (VALUES ('900000301'), ('900000302')) AS n(id) WHERE s."Record ID" = '2'
  ) ORDER BY CAST("Record ID" AS INTEGER)
) TO 'pipeline/test/fixtures/sample-next.csv' (HEADER);
```

`second-export.csv` is written by DuckDB, which adds no byte-order mark, so the mark is added afterwards. In the DuckDB CLI, with `s` as above:

```sql
COPY (
  SELECT * REPLACE (
    CASE "Record ID" WHEN '1' THEN replace(Title, 'Genistein ', 'Genistein' || chr(9)) ELSE Title END AS Title,
    regexp_replace(
      CASE "Record ID" WHEN '4952' THEN replace(replace(Institution, ' Kantar', chr(10) || 'Kantar'), ' Concord', chr(10) || 'Concord') WHEN '34181' THEN 'None' ELSE Institution END,
      ';\s*(\S)', ';' || chr(10) || '\1', 'g') AS Institution,
    CASE "Record ID" WHEN '1' THEN replace(Journal, 'of ', 'of  ') ELSE Journal END AS Journal,
    CASE "Record ID" WHEN '2' THEN replace(Author, 'Chang Han', 'Chang  Han') ELSE Author END AS Author,
    replace(URLS, ';', '; ') AS URLS,
    CASE "Record ID" WHEN '18930' THEN '6/24/1756 12:00:00 AM' ELSE RetractionDate END AS RetractionDate,
    CASE RetractionPubMedID WHEN '0' THEN '00000000' ELSE RetractionPubMedID END AS RetractionPubMedID,
    CASE "Record ID" WHEN '18930' THEN '1/1/1753 12:00:00 AM' ELSE OriginalPaperDate END AS OriginalPaperDate,
    CASE OriginalPaperPubMedID WHEN '0' THEN '00000000' ELSE OriginalPaperPubMedID END AS OriginalPaperPubMedID,
    CASE "Record ID" WHEN '69326' THEN replace(Notes, 'pdf. See', 'pdf.' || chr(10) || chr(10) || 'See') ELSE Notes END AS Notes
  ) FROM s
) TO 'pipeline/test/fixtures/second-export.body.csv' (HEADER);
```

```bash
{ printf '\xef\xbb\xbf'; cat pipeline/test/fixtures/second-export.body.csv; } > pipeline/test/fixtures/second-export.csv
rm pipeline/test/fixtures/second-export.body.csv
```
