// Temporary: a test that fails on purpose, to show that the Test workflow
// marks a pull request as failing (spec 003, task 2). Never merged.
import { expect, it } from 'vitest';

it('fails on purpose', () => {
  expect(1 + 1).toBe(3);
});
