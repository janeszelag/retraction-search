// How a record's Retraction Watch links read in results and on record pages
// (spec 002 AC18a), as in the prototype. Posts are dated in their address, and
// one post can cover a batch of retractions, so each link says how many
// records list it.
import { formatApYmd } from './dates';
import { formatRecords } from './numbers';

export interface RecordLink {
  href: string;
  // "Retraction Watch, Jan. 2, 2020", "Retraction Watch page" or the site's name.
  source: string;
  text: string;
  // "Linked from 10,855 records", or null when this record is the only one.
  shared: string | null;
}

const POST = /retractionwatch\.com\/(\d{4})\/(\d{2})\/(\d{2})\/([^/?#]+)/i;

export function describeLink(href: string, recordCount: number | undefined): RecordLink {
  const shared = recordCount && recordCount > 1 ? `Linked from ${formatRecords(recordCount)}` : null;
  const post = POST.exec(href);
  if (post) {
    let slug = post[4];
    try {
      slug = decodeURIComponent(slug);
    } catch {
      // Keep the address as written.
    }
    slug = slug.replace(/-/g, ' ');
    return {
      href,
      source: `Retraction Watch, ${formatApYmd(Number(post[1]), Number(post[2]), Number(post[3]))}`,
      // Post titles aren't in the data, so the text comes from the address.
      text: slug.charAt(0).toUpperCase() + slug.slice(1),
      shared,
    };
  }
  const host = /^https?:\/\/(?:www\.)?([^/]+)/i.exec(href)?.[1] ?? 'Link';
  return {
    href,
    // Other Retraction Watch pages, such as its site search, aren't posts. How to
    // label them is still open in spec 002.
    source: /retractionwatch\.com$/i.test(host) ? 'Retraction Watch page' : host,
    text: href.replace(/^https?:\/\/(www\.)?/i, ''),
    shared,
  };
}
