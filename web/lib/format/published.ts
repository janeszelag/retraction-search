// The "As Retraction Watch published it" table on record pages (spec 002 AC22):
// for each field the cleaning changed, the published text and what this site shows.
import type { ResultRecord } from '../search/types';
import { formatApDate, formatAsPublished } from './dates';

export interface PublishedRow {
  field: string;
  published: string;
  shown: string;
}

const listText = (list: string[]) => (list.length > 0 ? list.join('; ') : 'None listed');

export function publishedRows(record: ResultRecord): PublishedRow[] {
  const original = record.original;
  const rows: PublishedRow[] = [];
  const add = (field: string, published: string | undefined, shown: string, changed: boolean) => {
    if (published !== undefined && changed) {
      rows.push({ field, published: formatAsPublished(published) ?? '', shown });
    }
  };
  // Dates are always rewritten, from month/day/year text to a date.
  add('RetractionDate', original.notice_date, formatApDate(record.noticeDate), true);
  add('OriginalPaperDate', original.paper_date, formatApDate(record.paperDate), true);
  // Identifiers, where the published text isn't what's shown.
  const differs = (published: string | undefined, shown: string | null) => published !== undefined && published.trim() !== (shown ?? '');
  add('RetractionDOI', original.notice_doi, record.noticeDoi ?? 'None', differs(original.notice_doi, record.noticeDoi));
  add('OriginalPaperDOI', original.paper_doi, record.paperDoi ?? 'None', differs(original.paper_doi, record.paperDoi));
  const id = (value: number | null) => (value === null ? null : String(value));
  add('RetractionPubMedID', original.notice_pubmed_id, id(record.noticePubmedId) ?? 'None', differs(original.notice_pubmed_id, id(record.noticePubmedId)));
  add('OriginalPaperPubMedID', original.paper_pubmed_id, id(record.paperPubmedId) ?? 'None', differs(original.paper_pubmed_id, id(record.paperPubmedId)));
  // The pipeline keeps these only when it changed them.
  add('Author', original.author, listText(record.authors), true);
  add('Institution', original.institution, listText(record.institutions), true);
  add('Country', original.country, listText(record.countries), true);
  add('Journal', original.journal, record.journal, true);
  add('Publisher', original.publisher, record.publisher, true);
  return rows;
}
