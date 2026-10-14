const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// The data date with the month spelled out, as the header reads: "2026-10-09" → "October 9, 2026".
export function formatDataDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}
