import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Paths are resolved from this file, so commands work from any working directory.
export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
export const rawDir = path.join(repoRoot, 'data', 'raw');
export const cleanDir = path.join(repoRoot, 'data', 'clean');
export const sqlDir = fileURLToPath(new URL('../sql/', import.meta.url));

export function relativeToRepo(file) {
  return path.relative(repoRoot, file);
}
