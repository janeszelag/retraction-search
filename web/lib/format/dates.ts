const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// AP style abbreviates these months and spells out the rest.
const AP_MONTHS = ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];

// The data date with the month spelled out, as the header reads: "2026-10-09" → "October 9, 2026".
export function formatDataDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

// A document date (Unix seconds, negative before 1970) in AP style, as result
// lines read: "Sept. 24, 2026".
export function formatApDate(unixSeconds: number | null | undefined): string {
  if (unixSeconds === null || unixSeconds === undefined) {
    return 'date unknown';
  }
  const date = new Date(unixSeconds * 1000);
  return `${AP_MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

// A calendar date in AP style: (2020, 1, 2) → "Jan. 2, 2020".
export function formatApYmd(year: number, month: number, day: number): string {
  return `${AP_MONTHS[month - 1]} ${day}, ${year}`;
}

// A value as Retraction Watch published it, for record pages (spec 002 AC22).
export function formatAsPublished(text: string | null | undefined): string | null {
  if (text === null || text === undefined) {
    return null;
  }
  return text.trim() === '' ? '(blank)' : text;
}
