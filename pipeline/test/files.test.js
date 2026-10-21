import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findInvalidUtf8, gitBlobIdOf } from '../src/files.js';

describe('git blob IDs', () => {
  let dir;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'retraction-search-files-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // The expected IDs are what `git hash-object` prints for the same contents.
  it.each([
    ['an empty file', '', 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'],
    ['"hello" and a line break', 'hello\n', 'ce013625030ba8dba906f756967f9e9ca394464a'],
  ])('matches git for %s', async (_, contents, expected) => {
    const file = path.join(dir, 'file');
    await writeFile(file, contents);
    expect(await gitBlobIdOf(file)).toBe(expected);
  });
});

describe('finding bytes that are not valid UTF-8', () => {
  // Joins strings (as UTF-8) and arrays of raw bytes.
  const bytes = (...parts) => Buffer.concat(parts.map((part) => Buffer.from(part)));

  it('passes valid UTF-8, including four-byte characters', () => {
    expect(findInvalidUtf8(Buffer.from('Record ID,Title\n1,Café ’quoted’ 分析 😀\n'))).toBeNull();
  });

  it('counts Windows-1252 bytes and finds the line of the first', () => {
    // 0x92 is ’ and 0xE9 is é in Windows-1252.
    expect(findInvalidUtf8(bytes('a\nb\n', [0x92], 'c', [0xe9], '\n', [0xe9]))).toEqual({ count: 3, firstLine: 3 });
  });

  it.each([
    ['an overlong two-byte form', [0xc0, 0x80], 2],
    ['an overlong three-byte form', [0xe0, 0x80, 0x80], 3],
    ['a surrogate', [0xed, 0xa0, 0x80], 3],
    ['a code point above U+10FFFF', [0xf4, 0x90, 0x80, 0x80], 4],
    ['a lone continuation byte', [0x80], 1],
    ['a sequence cut short by a letter', [0xe2, 0x80, 0x41], 2],
    ['a sequence cut short at the end', [0xe2, 0x80], 2],
  ])('counts each byte of %s', (_, sequence, count) => {
    expect(findInvalidUtf8(bytes('ok\n', sequence))).toEqual({ count, firstLine: 2 });
  });
});
