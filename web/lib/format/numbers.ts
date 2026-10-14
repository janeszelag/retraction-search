// 67384 → "67,384"
export function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

// 1 → "1 record", 67384 → "67,384 records"
export function formatRecords(count: number): string {
  return `${formatNumber(count)} ${count === 1 ? 'record' : 'records'}`;
}
