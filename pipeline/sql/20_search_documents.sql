-- Builds one search document per record, shaped for Typesense (spec 001, AC13).
-- Reads `records` (see 10_records.sql). Missing values are left out when clean.js
-- writes the documents as JSON lines.
CREATE OR REPLACE TABLE documents AS
WITH
  -- A URL's key ignores http versus https and a trailing slash (spec 002, AC18a).
  url_entries AS (
    SELECT DISTINCT records.record_id, regexp_replace(regexp_replace(url, '^https?://', ''), '/+$', '') AS url_key
    FROM records, unnest(records.urls) AS entry(url)
  ),
  -- How many records list each URL, so a post about a batch of retractions
  -- isn't read as a story about one paper.
  url_counts AS (
    SELECT map_from_entries(list((url_key, CAST(record_count AS INTEGER)))) AS by_key
    FROM (SELECT url_key, count(*) AS record_count FROM url_entries GROUP BY url_key)
  )
SELECT
  -- Typesense document IDs are text.
  CAST(records.record_id AS VARCHAR) AS id,
  records.record_id,
  -- Searchable text.
  records.title,
  records.authors,
  records.institutions,
  records.journal,
  records.publisher,
  -- Filters (Goal 1 of the product brief).
  records.countries,
  list_sort(list_distinct([subject.code FOR subject IN records.subjects])) AS subject_categories,
  -- Subject names aren't unique across codes (Nutrition appears under BLS and HSC),
  -- so each subject keeps its code.
  [CASE WHEN subject.code IS NULL THEN subject.name ELSE subject.code || ': ' || subject.name END
   FOR subject IN records.subjects] AS subjects,
  records.article_types,
  records.reasons,
  records.notice_type,
  records.paywalled,
  records.is_revision,
  records.has_editorial_staff_author,
  -- Typesense has no date type, so dates are Unix seconds (negative before 1970).
  CAST(epoch(records.notice_date) AS BIGINT) AS notice_date,
  records.notice_year,
  CAST(epoch(records.paper_date) AS BIGINT) AS paper_date,
  records.paper_year,
  -- Identifiers.
  records.notice_doi,
  records.notice_pubmed_id,
  records.paper_doi,
  records.paper_pubmed_id,
  -- Stored for display, not searched.
  records.urls,
  -- One count per entry in `urls`, in the same order.
  [url_counts.by_key[regexp_replace(regexp_replace(url, '^https?://', ''), '/+$', '')] FOR url IN records.urls]
    AS url_record_counts,
  records.notes,
  records.original
FROM records, url_counts
ORDER BY records.record_id;
