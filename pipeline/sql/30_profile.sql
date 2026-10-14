-- Builds the tables behind the profile report (spec 001). reports.js turns them
-- into Markdown. Reads `source` and `records`.

-- AC1: empty values in every source column. The unnamed column that the
-- header's trailing comma creates (column20) is left out.
CREATE OR REPLACE TABLE profile_empty_values AS
UNPIVOT (
  SELECT CAST(sum(CASE WHEN nullif(trim(COLUMNS(lambda c: NOT regexp_matches(c, '^column[0-9]+$'))), '') IS NULL THEN 1 ELSE 0 END) AS INTEGER)
  FROM source
) ON COLUMNS(*) INTO NAME source_column VALUE empty;

-- AC1: each distinct value of every filter field, with the number of records
-- that have it. Field names match the search documents.
CREATE OR REPLACE TABLE profile_values AS
SELECT field, value, CAST(count(*) AS INTEGER) AS records
FROM (
  SELECT 'notice_type' AS field, notice_type AS value FROM records
  UNION ALL SELECT 'paywalled', paywalled FROM records
  UNION ALL SELECT 'reasons', unnest(list_distinct(reasons)) FROM records
  UNION ALL SELECT 'subject_categories', unnest(list_distinct([s.code FOR s IN subjects])) FROM records
  UNION ALL SELECT 'subjects', unnest(list_distinct([coalesce(s.code || ': ', '') || s.name FOR s IN subjects])) FROM records
  UNION ALL SELECT 'countries', unnest(list_distinct(countries)) FROM records
  UNION ALL SELECT 'article_types', unnest(list_distinct(article_types)) FROM records
  UNION ALL SELECT 'publisher', publisher FROM records
  UNION ALL SELECT 'notice_year', CAST(notice_year AS VARCHAR) FROM records
  UNION ALL SELECT 'paper_year', CAST(paper_year AS VARCHAR) FROM records
)
GROUP BY field, value
ORDER BY field, records DESC, value;

-- AC6, AC7 and AC11: values a person should look at.
CREATE OR REPLACE TABLE profile_review AS
SELECT issue, record_id, value
FROM (
  SELECT 'Notice date that could not be parsed' AS issue, record_id, original.notice_date AS value
  FROM records WHERE notice_date IS NULL AND nullif(trim(original.notice_date), '') IS NOT NULL
  UNION ALL
  SELECT 'Paper date that could not be parsed', record_id, original.paper_date
  FROM records WHERE paper_date IS NULL AND nullif(trim(original.paper_date), '') IS NOT NULL
  UNION ALL
  SELECT 'Notice dated before its paper', record_id,
         'notice ' || CAST(notice_date AS VARCHAR) || ', paper ' || CAST(paper_date AS VARCHAR)
  FROM records WHERE notice_date < paper_date
  UNION ALL
  SELECT 'Dated 1 January 1970', record_id,
         concat_ws(' and ',
           CASE WHEN notice_date = DATE '1970-01-01' THEN 'notice' END,
           CASE WHEN paper_date = DATE '1970-01-01' THEN 'paper' END)
  FROM records WHERE notice_date = DATE '1970-01-01' OR paper_date = DATE '1970-01-01'
  UNION ALL
  SELECT 'DOI whose source text does not start with "10."', record_id, 'notice DOI ' || original.notice_doi
  FROM records WHERE notice_doi IS NOT NULL AND NOT starts_with(lower(trim(original.notice_doi)), '10.')
  UNION ALL
  SELECT 'DOI whose source text does not start with "10."', record_id, 'paper DOI ' || original.paper_doi
  FROM records WHERE paper_doi IS NOT NULL AND NOT starts_with(lower(trim(original.paper_doi)), '10.')
  UNION ALL
  SELECT 'Subject without a code', record_id, subject.name
  FROM (SELECT record_id, unnest(subjects) AS subject FROM records)
  WHERE subject.code IS NULL
  UNION ALL
  SELECT 'Backtick in an author name', record_id, original.author
  FROM records WHERE contains(original.author, '`')
  UNION ALL
  SELECT 'Journal or publisher spelling merged', record_id, 'journal "' || trim(original.journal) || '" became "' || journal || '"'
  FROM records WHERE original.journal IS NOT NULL
  UNION ALL
  SELECT 'Journal or publisher spelling merged', record_id, 'publisher "' || trim(original.publisher) || '" became "' || publisher || '"'
  FROM records WHERE original.publisher IS NOT NULL
)
ORDER BY issue, record_id, value;

-- AC12, plus the placeholder and DOI rules: how many records each applies to.
CREATE OR REPLACE TABLE profile_flags AS
SELECT position, flag, CAST(records AS INTEGER) AS records
FROM (
  SELECT 1 AS position, 'Revised version (is_revision)' AS flag, count(*) FILTER (WHERE is_revision) AS records FROM records
  UNION ALL SELECT 2, 'Editorial Staff author (has_editorial_staff_author)', count(*) FILTER (WHERE has_editorial_staff_author) FROM records
  UNION ALL SELECT 3, 'Author placeholder rewritten to "Unknown"', count(*) FILTER (
    WHERE len([entry FOR entry IN split_list(original.author)
               IF lower(entry) IN ('unknown', 'unavailable', 'not available') AND entry <> 'Unknown']) > 0
  ) FROM records
  UNION ALL SELECT 4, 'Institution placeholder rewritten to "Unknown"', count(*) FILTER (WHERE original.institution IS NOT NULL) FROM records
  UNION ALL SELECT 5, 'Country placeholder rewritten to "Unknown"', count(*) FILTER (WHERE original.country IS NOT NULL) FROM records
  UNION ALL SELECT 6, 'Stray "x" removed from a DOI', count(*) FILTER (
    WHERE (starts_with(lower(trim(original.notice_doi)), 'x') AND starts_with(notice_doi, '10.'))
       OR (starts_with(lower(trim(original.paper_doi)), 'x') AND starts_with(paper_doi, '10.'))
  ) FROM records
  -- Spec 002's name rules.
  UNION ALL SELECT 7, 'Backtick fixed in an author name', count(*) FILTER (WHERE contains(original.author, '`')) FROM records
  UNION ALL SELECT 8, 'Journal spelling merged into the most common one', count(*) FILTER (WHERE original.journal IS NOT NULL) FROM records
  UNION ALL SELECT 9, 'Publisher spelling merged into the most common one', count(*) FILTER (WHERE original.publisher IS NOT NULL) FROM records
)
ORDER BY position;
