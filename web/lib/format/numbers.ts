// 67384 → "67,384"
export function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}
