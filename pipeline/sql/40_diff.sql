-- Compares two snapshots by Record ID (spec 003, AC4 and AC5). It compares
-- the text Retraction Watch published, not the cleaned values, so it reports
-- Retraction Watch's changes rather than the cleaning's. A difference that only
-- comes from how an export writes a value isn't a change (format_blind, changed
-- 2026-10-25); the results still show the published text.
-- Needs two tables, each loaded by 00_load.sql, 02_formats.sql and
-- 05_empty_rows.sql: previous_source (the loaded snapshot) and source (the new one).
-- To run by hand in the DuckDB CLI, load the old file, then
-- ALTER TABLE source RENAME TO previous_source; then load the new file.

-- Source columns in the new file's order, for sorting the results.
CREATE OR REPLACE TEMP TABLE diff_column_order AS
SELECT column_name AS source_column, column_index AS position
FROM duckdb_columns()
WHERE table_name = 'source' AND column_name <> 'Record ID';

-- One row per record and source column, with the published text. INCLUDE
-- NULLS keeps empty values, so a value going from empty to filled is a
-- change. An empty string counts as empty, like a missing value.
CREATE OR REPLACE TEMP TABLE diff_previous AS
SELECT CAST("Record ID" AS INTEGER) AS record_id, source_column, nullif(value, '') AS value
FROM previous_source
UNPIVOT INCLUDE NULLS (value FOR source_column IN (COLUMNS(* EXCLUDE ("Record ID"))));

CREATE OR REPLACE TEMP TABLE diff_new AS
SELECT CAST("Record ID" AS INTEGER) AS record_id, source_column, nullif(value, '') AS value
FROM source
UNPIVOT INCLUDE NULLS (value FOR source_column IN (COLUMNS(* EXCLUDE ("Record ID"))));

-- Values that differ, for records in both snapshots. A column that only one
-- file has, such as the empty one from a header's trailing comma, is left out.
CREATE OR REPLACE TEMP TABLE diff_pairs AS
SELECT
  p.record_id,
  p.source_column,
  p.value AS old_value,
  n.value AS new_value,
  -- A field that was filled and is now empty or only spaces, tabs or line breaks.
  nullif(collapse_space(p.value), '') IS NOT NULL AND nullif(collapse_space(n.value), '') IS NULL AS emptied
FROM diff_previous AS p
JOIN diff_new AS n USING (record_id, source_column)
WHERE nullif(format_blind(p.source_column, p.value), '') IS DISTINCT FROM nullif(format_blind(n.source_column, n.value), '');

CREATE OR REPLACE TABLE diff_records AS
WITH ids AS (
  SELECT
    coalesce(p.record_id, n.record_id) AS record_id,
    p.record_id IS NOT NULL AS in_previous,
    n.record_id IS NOT NULL AS in_new
  FROM (SELECT DISTINCT CAST("Record ID" AS INTEGER) AS record_id FROM previous_source) AS p
  FULL JOIN (SELECT DISTINCT CAST("Record ID" AS INTEGER) AS record_id FROM source) AS n
    ON p.record_id = n.record_id
)
SELECT record_id, 'added' AS change, []::VARCHAR[] AS changed_columns, []::VARCHAR[] AS emptied_columns
FROM ids WHERE NOT in_previous
UNION ALL
SELECT record_id, 'removed', [], []
FROM ids WHERE NOT in_new
UNION ALL
SELECT
  record_id,
  'changed',
  list(source_column ORDER BY position),
  coalesce(list(source_column ORDER BY position) FILTER (WHERE emptied), [])
FROM diff_pairs JOIN diff_column_order USING (source_column)
GROUP BY record_id;

-- Changed records per column, and how many of those had the column emptied.
CREATE OR REPLACE TABLE diff_columns AS
SELECT
  source_column,
  CAST(count(*) AS INTEGER) AS changed_records,
  CAST(count(*) FILTER (WHERE emptied) AS INTEGER) AS emptied_records,
  any_value(position) AS position
FROM diff_pairs JOIN diff_column_order USING (source_column)
GROUP BY source_column;

-- Old and new text where the notice type or the reasons changed (AC5).
CREATE OR REPLACE TABLE diff_values AS
SELECT record_id, source_column, old_value, new_value, position
FROM diff_pairs JOIN diff_column_order USING (source_column)
WHERE source_column IN ('RetractionNature', 'Reason');

CREATE OR REPLACE TABLE diff_counts AS
SELECT
  (SELECT CAST(count(*) AS INTEGER) FROM previous_source) AS previous_records,
  (SELECT CAST(count(*) AS INTEGER) FROM source) AS new_records,
  CAST(count(*) FILTER (WHERE change = 'added') AS INTEGER) AS added,
  CAST(count(*) FILTER (WHERE change = 'removed') AS INTEGER) AS removed,
  CAST(count(*) FILTER (WHERE change = 'changed') AS INTEGER) AS changed,
  -- Records with at least one field that went from filled to empty.
  CAST(count(*) FILTER (WHERE len(emptied_columns) > 0) AS INTEGER) AS emptied
FROM diff_records;
