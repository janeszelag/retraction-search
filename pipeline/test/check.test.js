import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkSnapshot } from '../src/check.js';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

describe('full-snapshot check', () => {
  it('passes every check on the sample', async () => {
    const { rows, results } = await checkSnapshot(fixture('sample.csv'));
    expect(rows).toBe(37);
    expect(results.map((result) => result.label)).toEqual(['AC2', 'AC2', 'AC10', 'AC12', 'AC5', 'time']);
    for (const result of results) {
      expect(result.passed, result.detail).toBe(true);
    }
  });

  it('fails loudly when the input is broken', async () => {
    await expect(checkSnapshot(fixture('renamed-column.csv'))).rejects.toThrow('Column check failed');
  });
});
