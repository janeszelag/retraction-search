import { describe, expect, it } from 'vitest';
import expected from './fixtures/reasons-2026-10-09.json';
import { REASON_GROUPS, reasonGroup } from './reasons';

describe('reason groups (AC9, AC18)', () => {
  const reasons = Object.entries(expected as Record<string, string>);

  it('covers the 112 reasons in the 2026-10-09 snapshot', () => {
    expect(reasons).toHaveLength(112);
  });

  it.each(reasons)('puts "%s" in %s', (reason, group) => {
    expect(reasonGroup(reason).name).toBe(group);
  });

  it('leaves exactly two reasons in "Other"', () => {
    expect(reasons.filter(([reason]) => reasonGroup(reason).id === 'other').map(([reason]) => reason)).toEqual([
      'Concerns/Issues about Article',
      'Error by Third Party',
    ]);
  });

  it('puts a reason it has never seen in "Other"', () => {
    expect(reasonGroup('A reason added next year').id).toBe('other');
  });

  it('gives every group its theme classes', () => {
    for (const group of REASON_GROUPS) {
      expect(group.classes).toBe(`bg-reason-${group.id} text-reason-${group.id}-ink border-reason-${group.id}-line`);
    }
  });
});
