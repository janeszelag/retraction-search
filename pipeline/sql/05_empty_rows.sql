-- Drops rows where every column is empty or only spaces, tabs or line breaks
-- (spec 001 AC2, changed 2026-10-14 and 2026-10-25). Some upstream files end
-- with rows of commas and nothing else. A row with any value at all is kept,
-- so the checks after this still see it. The profile report gives the number
-- dropped. Needs the macros in 02_formats.sql.
CREATE OR REPLACE TABLE empty_rows AS
SELECT rowid AS source_row
FROM source
-- In a WHERE clause, COLUMNS(*) applies the condition to every column and
-- joins the results with AND.
WHERE nullif(collapse_space(COLUMNS(*)), '') IS NULL;

DELETE FROM source WHERE rowid IN (SELECT source_row FROM empty_rows);
