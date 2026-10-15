-- Drops rows where every column is empty or only spaces (spec 001 AC2,
-- changed 2026-10-14). Some upstream files end with rows of commas and
-- nothing else. A row with any value at all is kept, so the checks after this
-- still see it. The profile report gives the number dropped.
CREATE OR REPLACE TABLE empty_rows AS
SELECT rowid AS source_row
FROM source
-- In a WHERE clause, COLUMNS(*) applies the condition to every column and
-- joins the results with AND.
WHERE nullif(trim(COLUMNS(*)), '') IS NULL;

DELETE FROM source WHERE rowid IN (SELECT source_row FROM empty_rows);
