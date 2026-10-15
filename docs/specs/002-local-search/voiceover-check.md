# Manual check: one full search with VoiceOver

Spec 002 AC32 asks for a manual VoiceOver check that covers one full search. Automated checks (axe in `npm run test:e2e`) can't tell whether the announcements make sense in order, so a person listens to them.

## Setup

- A Mac with VoiceOver, and Safari, which VoiceOver supports best.
- The local stack and site running: `npm run search:up`, then `npm run web`, and http://localhost:3000 open in Safari.
- Turn VoiceOver on with Command-F5. "VO" below means Control-Option.
- Use the keyboard only. Tab and Shift-Tab move between controls; VO-Right Arrow reads the next item; VO-U opens the rotor (Left and Right Arrow switch lists, such as headings, links and form controls).

## Steps

Each step lists what VoiceOver should say. Record a pass or fail and anything confusing.

| # | Do | Expect to hear |
|---|---|---|
| 1 | Load the start page. Open the rotor's headings list. | The page title "Retraction search", and headings including the total ("67,384 retractions" on the 2026-10-09 snapshot), "Filters" and each filter's name. |
| 2 | Tab to the search box. | "Search, search text field", with its placeholder about titles, author names, journals and publishers. |
| 3 | Type `neuron` and wait a moment. | Once the results update, one sentence with the new total and page, such as "271 retractions, page 1 of 14." Focus stays in the search box. |
| 4 | Press Tab, then activate the link with VO-Space. | "Skip to results, link". After it, the next Tab goes to the first control in the results, the summary's first remove button, not into the filters. |
| 5 | Move through the summary under the total. | The summary chips, each read with its text, and each chip's remove button read as "Remove" and the chip's text. |
| 6 | Open the rotor's landmarks list and choose Filters, then Tab to the Notice type values. | Each value read as a link with its name, its count and its state, such as "Retraction, 271 records, selected" and "Expression of concern, 20 records". The exclude control is separate: "Exclude Expression of concern". |
| 7 | Activate "Expression of concern". | One sentence with the new totals, such as "271 retractions and 20 expressions of concern, page 1 of 15." The notice-type labels in results are read as words ("Retraction", "Expression of concern"), not only colors. |
| 8 | Tab to a Reason caveat's "Read more" link. | "Read more, link". Its note before it is reachable with VO-Right Arrow ("Retraction Watch's classification…"). |
| 9 | Tab to a year filter's "from" field and type `2015`. | "Notice year from, edit text". After a pause, one sentence with the new total. |
| 10 | In the first result, Tab to "All fields" and activate it. | "All fields, button, collapsed", then "Fewer fields, button, expanded"; the extra fields follow it in reading order. |
| 11 | Tab to an author name in a result and activate it. | "Show records that list the name …, link". On the new results, the yellow note is read: "Name matches only. These records list the name as written…". |
| 12 | Go back (Command-[ ), then open the first result's title link. | The record page's title heading. The page has no search box. "Back to results, button" is there. |
| 13 | Activate "Copy link to this record". | "Link copied." |
| 14 | Activate "Back to results". | The results return, at the same place in the list. |
| 15 | Tab to "Download CSV" and activate it. | A status message ("Preparing the file…", then "Downloaded retraction-search-….csv."), without a stream of size updates. |
| 16 | Tab to "Cite this search" and activate it. | "Cite this search, button, expanded", then the citation text and a "Copy" button. |
| 17 | At a narrow window (or 375 px in Safari's Responsive Design Mode), activate "Filters". | A dialog named "Filters"; focus moves into it; Escape closes it and returns focus to the button. |

## Results

| Date | macOS | Safari | Snapshot | Result | Notes |
|---|---|---|---|---|---|
| | | | | | |
