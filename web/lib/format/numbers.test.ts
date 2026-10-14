import { describe, expect, it } from 'vitest';
import { formatNumber, formatRecords } from './numbers';

describe('numbers', () => {
  it('groups thousands', () => {
    expect(formatNumber(67384)).toBe('67,384');
  });

  it('counts records in the singular and plural', () => {
    expect(formatRecords(1)).toBe('1 record');
    expect(formatRecords(0)).toBe('0 records');
    expect(formatRecords(10855)).toBe('10,855 records');
  });
});
