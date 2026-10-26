-- Loads the source CSV with every column as text, so DuckDB guesses nothing.
-- It reads on one thread: the parallel reader stops on some files of upstream's
-- second export, which has line breaks inside fields (spec 001, changed 2026-10-25).
-- DuckDB skips a leading byte-order mark, so the first column is "Record ID" either way.
-- To run by hand in the DuckDB CLI, set the input path first:
--   SET VARIABLE input_path = 'data/raw/retraction_watch-2026-10-09-bc5648dd.csv';
CREATE OR REPLACE TABLE source AS
SELECT *
FROM read_csv(
  getvariable('input_path'),
  header = true,
  all_varchar = true,
  delim = ',',
  quote = '"',
  escape = '"',
  parallel = false
);
