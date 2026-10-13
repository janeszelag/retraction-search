-- Cleans every source row into one typed record. Reads `source` (see 00_load.sql).
-- Comments name the spec 001 acceptance criterion each rule serves.

-- AC6: dates are month/day/year, with a time that's always 0:00.
-- A value that can't be parsed becomes NULL and is listed in the profile report.
CREATE OR REPLACE MACRO parse_rw_date(value) AS
  CAST(try_strptime(trim(value), '%-m/%-d/%Y %-H:%M') AS DATE);

-- AC7: DOIs are trimmed, percent-decoded (%3C becomes <) and lowercased.
-- Blank and "unavailable" in any capitalization mean there's no DOI.
CREATE OR REPLACE MACRO clean_doi(value) AS
  CASE
    WHEN nullif(trim(value), '') IS NULL OR lower(trim(value)) = 'unavailable' THEN NULL
    ELSE lower(url_decode(trim(value)))
  END;

-- AC8: blank and 0 mean there's no PubMed ID.
CREATE OR REPLACE MACRO clean_pubmed_id(value) AS
  CASE
    WHEN nullif(trim(value), '') IS NULL OR trim(value) = '0' THEN NULL
    ELSE CAST(trim(value) AS INTEGER)
  END;

CREATE OR REPLACE TABLE records AS
SELECT
  CAST("Record ID" AS INTEGER) AS record_id,
  parse_rw_date(RetractionDate) AS notice_date,
  CAST(year(notice_date) AS INTEGER) AS notice_year,
  clean_doi(RetractionDOI) AS notice_doi,
  clean_pubmed_id(RetractionPubMedID) AS notice_pubmed_id,
  parse_rw_date(OriginalPaperDate) AS paper_date,
  CAST(year(paper_date) AS INTEGER) AS paper_year,
  clean_doi(OriginalPaperDOI) AS paper_doi,
  clean_pubmed_id(OriginalPaperPubMedID) AS paper_pubmed_id,
  -- AC4: the source text of every value above that the cleaning rewrites.
  {
    'notice_date': RetractionDate,
    'notice_doi': RetractionDOI,
    'notice_pubmed_id': RetractionPubMedID,
    'paper_date': OriginalPaperDate,
    'paper_doi': OriginalPaperDOI,
    'paper_pubmed_id': OriginalPaperPubMedID
  } AS original
FROM source
ORDER BY record_id;
