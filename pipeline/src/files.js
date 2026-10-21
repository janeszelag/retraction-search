import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

export async function sha256Of(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

// Git's name for a file's contents, which GitLab reports as x-gitlab-blob-id:
// the SHA-1 of "blob <size>", a zero byte and the file's bytes.
export async function gitBlobIdOf(file) {
  const { size } = await stat(file);
  const hash = createHash('sha1').update(`blob ${size}\0`);
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

// Returns null for valid UTF-8. Otherwise counts the bytes that aren't valid
// UTF-8 and finds the line of the first one. A byte that can't start or
// continue a valid sequence counts once, and so does each byte of a sequence
// cut short.
export function findInvalidUtf8(bytes) {
  if (isUtf8(bytes)) {
    return null;
  }
  let count = 0;
  let firstLine = null;
  let line = 1;
  let i = 0;
  while (i < bytes.length) {
    const length = validSequenceLength(bytes, i);
    if (length === 0) {
      count += 1;
      firstLine ??= line;
      i += 1;
    } else {
      if (bytes[i] === 0x0a) {
        line += 1;
      }
      i += length;
    }
  }
  return { count, firstLine };
}

// The length of the valid UTF-8 sequence that starts at `i`, or 0 if none does.
// The second byte's range follows table 3-7 of the Unicode Standard, which rules
// out overlong forms, surrogates and code points above U+10FFFF.
function validSequenceLength(bytes, i) {
  const lead = bytes[i];
  if (lead < 0x80) {
    return 1;
  }
  let length;
  let low = 0x80;
  let high = 0xbf;
  if (lead >= 0xc2 && lead <= 0xdf) {
    length = 2;
  } else if (lead >= 0xe0 && lead <= 0xef) {
    length = 3;
    if (lead === 0xe0) {
      low = 0xa0;
    } else if (lead === 0xed) {
      high = 0x9f;
    }
  } else if (lead >= 0xf0 && lead <= 0xf4) {
    length = 4;
    if (lead === 0xf0) {
      low = 0x90;
    } else if (lead === 0xf4) {
      high = 0x8f;
    }
  } else {
    return 0;
  }
  if (i + length > bytes.length || bytes[i + 1] < low || bytes[i + 1] > high) {
    return 0;
  }
  for (let k = 2; k < length; k += 1) {
    if (bytes[i + k] < 0x80 || bytes[i + k] > 0xbf) {
      return 0;
    }
  }
  return length;
}

export async function fileExists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}
