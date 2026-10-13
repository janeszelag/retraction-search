-- Loads the source CSV with every column as text, so DuckDB guesses nothing.
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
  escape = '"'
);
