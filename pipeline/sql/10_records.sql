-- Cleans every source row into one typed record. Reads `source` (see 00_load.sql)
-- and uses the macros in 02_formats.sql, which also parse dates (AC6).
-- Comments name the spec 001 acceptance criterion each rule serves.

-- AC7: DOIs are trimmed, percent-decoded (%3C becomes <) and lowercased.
-- Blank and "unavailable" in any capitalization mean there's no DOI.
-- Stray "x" characters before "10." are removed: Retraction Watch appears to
-- add them to keep a notice DOI unique when several records share one notice.
CREATE OR REPLACE MACRO clean_doi(value) AS
  CASE
    WHEN nullif(trim(value), '') IS NULL OR lower(trim(value)) = 'unavailable' THEN NULL
    ELSE regexp_replace(lower(url_decode(trim(value))), '^x+(10\.)', '\1')
  END;

-- AC8: blank, 0 and 00000000 mean there's no PubMed ID.
CREATE OR REPLACE MACRO clean_pubmed_id(value) AS
  CASE
    WHEN missing_pubmed_id(value) THEN NULL
    ELSE CAST(trim(value) AS INTEGER)
  END;

-- AC9: splits a semicolon-separated field into a list. Each entry's spaces,
-- tabs and line breaks are collapsed (changed 2026-10-25), empty entries (such
-- as after a trailing semicolon) are dropped, and order is kept. A line break
-- never splits: inside an entry it usually falls within one affiliation.
CREATE OR REPLACE MACRO split_list(value) AS
  [collapse_space(entry) FOR entry IN string_split(coalesce(value, ''), ';') IF collapse_space(entry) <> ''];

-- AC9: author, institution and country lists write "we don't know" several ways
-- ("unavailable", "Not available", "unknown"). Every spelling becomes "Unknown".
CREATE OR REPLACE MACRO unknown_if_placeholder(entry) AS
  CASE WHEN lower(entry) IN ('unknown', 'unavailable', 'not available') THEN 'Unknown' ELSE entry END;

CREATE OR REPLACE MACRO split_list_with_unknown(value) AS
  [unknown_if_placeholder(entry) FOR entry IN split_list(value)];

-- Spec 002: a backtick in an author name is bad data, and Typesense filters can't
-- hold one. Between two letters it becomes an apostrophe, as in "O'Example";
-- anywhere else it's removed.
CREATE OR REPLACE MACRO clean_author(entry) AS
  replace(regexp_replace(entry, '(\p{L})`(\p{L})', '\1''\2', 'g'), '`', '');

-- Spec 002: journal and publisher spellings that differ only in capitals or
-- accents ("medRxiv" and "medrxiv") become the most common spelling, ties going
-- to the first in sort order. Typesense's filters ignore capitals and accents,
-- so separate spellings would give filter counts that disagree with the results.
CREATE OR REPLACE TABLE preferred_spellings AS
SELECT field, folded, value AS spelling
FROM (
  SELECT field, value, lower(strip_accents(value)) AS folded,
         row_number() OVER (PARTITION BY field, lower(strip_accents(value)) ORDER BY count(*) DESC, value) AS rank
  FROM (
    SELECT 'journal' AS field, nullif(collapse_space(Journal), '') AS value FROM source
    UNION ALL SELECT 'publisher', nullif(collapse_space(Publisher), '') FROM source
  )
  WHERE value IS NOT NULL
  GROUP BY field, value
)
WHERE rank = 1;

-- AC11: "(HSC) Medicine - Surgery" becomes code HSC and name "Medicine - Surgery".
-- A subject without a code gets a NULL code and is listed in the profile report.
CREATE OR REPLACE MACRO parse_subject(subject) AS {
  'code': nullif(regexp_extract(subject, '^\(([^)]*)\)', 1), ''),
  'name': trim(regexp_replace(subject, '^\([^)]*\)', ''))
};

CREATE OR REPLACE TABLE records AS
SELECT
  CAST("Record ID" AS INTEGER) AS record_id,
  -- AC9: these can contain semicolons but aren't lists, so they're never split.
  -- Their spaces, tabs and line breaks are collapsed, like list entries'.
  nullif(collapse_space(Title), '') AS title,
  coalesce(preferred_journal.spelling, nullif(collapse_space(Journal), '')) AS journal,
  coalesce(preferred_publisher.spelling, nullif(collapse_space(Publisher), '')) AS publisher,
  [clean_author(entry) FOR entry IN split_list_with_unknown(Author)] AS authors,
  split_list_with_unknown(none_as_empty(Institution)) AS institutions,
  split_list_with_unknown(Country) AS countries,
  split_list(URLS) AS urls,
  split_list(ArticleType) AS article_types,
  split_list(Reason) AS reasons,
  [parse_subject(subject) FOR subject IN split_list(Subject)] AS subjects,
  -- AC12: one notice type per record; clean.js checks it's always present.
  nullif(trim(RetractionNature), '') AS notice_type,
  parse_rw_date(RetractionDate) AS notice_date,
  CAST(year(notice_date) AS INTEGER) AS notice_year,
  clean_doi(RetractionDOI) AS notice_doi,
  clean_pubmed_id(RetractionPubMedID) AS notice_pubmed_id,
  parse_rw_date(OriginalPaperDate) AS paper_date,
  CAST(year(paper_date) AS INTEGER) AS paper_year,
  clean_doi(OriginalPaperDOI) AS paper_doi,
  clean_pubmed_id(OriginalPaperPubMedID) AS paper_pubmed_id,
  -- AC12: Yes, No or Unknown, as Retraction Watch recorded it.
  nullif(trim(Paywalled), '') AS paywalled,
  list_contains(article_types, 'Revision') AS is_revision,
  len([author FOR author IN authors IF author ILIKE '%editorial staff%']) > 0 AS has_editorial_staff_author,
  nullif(collapse_space(Notes), '') AS notes,
  -- AC4: the source text of every value above that the cleaning rewrites.
  -- List fields keep every entry in order, so their source text can be rebuilt,
  -- except where a placeholder became "Unknown" or an author's backtick was
  -- fixed; then the source text is kept too. So is a journal or publisher
  -- spelling that was merged into another. Changes to whitespace alone aren't
  -- kept (changed 2026-10-25).
  {
    'notice_date': RetractionDate,
    'notice_doi': RetractionDOI,
    'notice_pubmed_id': RetractionPubMedID,
    'paper_date': OriginalPaperDate,
    'paper_doi': OriginalPaperDOI,
    'paper_pubmed_id': OriginalPaperPubMedID,
    'author': CASE WHEN split_list(Author) <> authors THEN Author END,
    'institution': CASE WHEN split_list(Institution) <> institutions THEN Institution END,
    'country': CASE WHEN split_list(Country) <> countries THEN Country END,
    -- (Compared with the preferred spelling: "journal" here would mean the source column.)
    'journal': CASE WHEN nullif(collapse_space(Journal), '') <> preferred_journal.spelling THEN Journal END,
    'publisher': CASE WHEN nullif(collapse_space(Publisher), '') <> preferred_publisher.spelling THEN Publisher END
  } AS original
FROM source
LEFT JOIN preferred_spellings AS preferred_journal
  ON preferred_journal.field = 'journal' AND preferred_journal.folded = lower(strip_accents(nullif(collapse_space(source.Journal), '')))
LEFT JOIN preferred_spellings AS preferred_publisher
  ON preferred_publisher.field = 'publisher' AND preferred_publisher.folded = lower(strip_accents(nullif(collapse_space(source.Publisher), '')))
ORDER BY record_id;

-- AC10: splitting loses and invents nothing. For each list field, the number of
-- list entries must equal the number of semicolon-separated items in the source
-- text that hold something besides spaces, tabs and line breaks, counted here
-- independently with a regular expression. An Institution of None has no items.
-- A view, so the check always reflects the current tables.
CREATE OR REPLACE MACRO source_items(value) AS
  len(regexp_extract_all(value, '[^;]*[^;\s][^;]*'));

CREATE OR REPLACE VIEW list_integrity AS
WITH entries AS (
  SELECT
    sum(len(authors)) AS authors,
    sum(len(institutions)) AS institutions,
    sum(len(countries)) AS countries,
    sum(len(urls)) AS urls,
    sum(len(article_types)) AS article_types,
    sum(len(reasons)) AS reasons,
    sum(len(subjects)) AS subjects
  FROM records
),
items AS (
  SELECT
    sum(source_items(Author)) AS authors,
    sum(source_items(none_as_empty(Institution))) AS institutions,
    sum(source_items(Country)) AS countries,
    sum(source_items(URLS)) AS urls,
    sum(source_items(ArticleType)) AS article_types,
    sum(source_items(Reason)) AS reasons,
    sum(source_items(Subject)) AS subjects
  FROM source
)
SELECT field, CAST(coalesce(entry_count, 0) AS INTEGER) AS entries, CAST(coalesce(item_count, 0) AS INTEGER) AS source_items
FROM (
  SELECT 'authors' AS field, entries.authors AS entry_count, items.authors AS item_count FROM entries, items
  UNION ALL SELECT 'institutions', entries.institutions, items.institutions FROM entries, items
  UNION ALL SELECT 'countries', entries.countries, items.countries FROM entries, items
  UNION ALL SELECT 'urls', entries.urls, items.urls FROM entries, items
  UNION ALL SELECT 'article_types', entries.article_types, items.article_types FROM entries, items
  UNION ALL SELECT 'reasons', entries.reasons, items.reasons FROM entries, items
  UNION ALL SELECT 'subjects', entries.subjects, items.subjects FROM entries, items
);
