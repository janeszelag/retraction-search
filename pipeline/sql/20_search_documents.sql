-- Builds one search document per record, shaped for Typesense (spec 001, AC13).
-- Reads `records` (see 10_records.sql). Missing values are left out when clean.js
-- writes the documents as JSON lines.
CREATE OR REPLACE TABLE documents AS
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
  records.notes,
  records.original
FROM records
ORDER BY records.record_id;
