-- How the two exports upstream publishes write values (spec 001, changed
-- 2026-10-25). The first export writes each value on one line; the second
-- adds line breaks and repeated spaces, writes a missing PubMed ID as
-- 00000000, and writes some dates with seconds and AM or PM. The cleaning
-- and the diff (40_diff.sql) both use these macros.

-- AC9: each run of spaces, tabs and line breaks becomes one space, and any at
-- the start or end is removed. In DuckDB's regular expressions, \s matches only
-- ASCII whitespace, so non-breaking spaces are left as published.
CREATE OR REPLACE MACRO collapse_space(value) AS
  trim(regexp_replace(value, '\s+', ' ', 'g'));

-- AC6: dates are month/day/year, with a time that's always midnight: 0:00 in
-- the first export, and 12:00:00 AM where the second export differs.
-- A value that can't be parsed becomes NULL and is listed in the profile report.
CREATE OR REPLACE MACRO parse_rw_date(value) AS
  CAST(try_strptime(trim(value), ['%-m/%-d/%Y %-H:%M', '%-m/%-d/%Y %-I:%M:%S %p']) AS DATE);

-- AC8: blank, 0 and 00000000 all mean there's no PubMed ID.
CREATE OR REPLACE MACRO missing_pubmed_id(value) AS
  coalesce(regexp_full_match(trim(value), '0*'), true);

-- AC9 (changed 2026-10-25): an Institution that is exactly None means there's
-- no institution. Record 34181 is written that way in some files and left
-- empty in others.
CREATE OR REPLACE MACRO none_as_empty(value) AS
  CASE WHEN collapse_space(value) = 'None' THEN NULL ELSE value END;

-- Spec 003 AC4 (changed 2026-10-25): a value as the diff compares it, so that
-- a difference that only comes from how an export writes a value isn't a
-- change. Every column: runs of spaces, tabs and line breaks. List columns:
-- spaces around semicolons. PubMed IDs: blank, 0 and 00000000. Dates: either
-- of the two forms. Institution: empty and None. The diff still shows the
-- published text.
CREATE OR REPLACE MACRO format_blind(source_column, value) AS
  CASE
    WHEN source_column = 'Institution' AND none_as_empty(value) IS NULL THEN NULL
    WHEN source_column IN ('RetractionPubMedID', 'OriginalPaperPubMedID') AND missing_pubmed_id(value) THEN '0'
    WHEN source_column IN ('RetractionDate', 'OriginalPaperDate') AND parse_rw_date(value) IS NOT NULL
      THEN CAST(parse_rw_date(value) AS VARCHAR)
    WHEN source_column IN ('Author', 'Institution', 'Country', 'URLS', 'ArticleType', 'Reason', 'Subject')
      THEN regexp_replace(collapse_space(value), ' ?; ?', ';', 'g')
    ELSE collapse_space(value)
  END;
