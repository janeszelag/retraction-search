# retraction-search

The readme is written by me, not AI. All other docs are written mainly by Claude with small edits from me.

## What

Personal, side project building out a website that allows anyone to search the Retraction Watch database.

## Why

See `docs/product-brief.md` for full details.

I recently became obsessed with Sholto David's [youtube channel](https://www.youtube.com/@Sholto_David) which features his investigations into scientific misconduct and flaws in research papers. This led me to the blogs [For Better Science](https://forbetterscience.com/about/)  (which covers research integrity, biomedical ethics and academic publishing) and [Retraction Watch](https://retractionwatch.com/) which monitors and reports on retraction and correction of scientific literature.

Retraction Watch operates under a U.S. nonprofit called The Center for Scientific Integrity (CSI), and maintains the [Retraction Watch Database](https://retractiondatabase.org/), a comprehensive, openly accessible database containing over 67,000 retractions ([updated daily via Crossref GitLab](https://gitlab.com/crossref/retraction-watch-data)).

The search interface currently available is lacking (for example you cannot search by reason), and the blog itself points heavy users to the full dataset instead. While it is great that the CSV has been made available, it also requires some cleaning (see `/docs/data-issues.md`).

Given my previous research experience (Masters degree in Physiology from the University of Toronto), this seemed like a fun and interesting project. I especially liked that this project spans the fullstack: from data cleaning to designing the UI for this search.

## Learning Goals

- Data pipeline set up (GitHub actions), testing
- TypeScript
- Hosting a Typesense server (cost, set up)
- Next.js server functions
- Natural language search

## Concerns

My biggest initial concern with this project is unexpected costs whether it's from bugs, bots, improper key storage or high volume searches.

I of course also want to ensure proper attribution to Retraction Watch and Crossref, and to only report what data already exists - not allege anything new.

## How

Using Claude (mainly Opus 5.5) and spec driven development.
