// Downloads one snapshot of the Retraction Watch CSV, pinned by its upstream commit,
// and writes a manifest next to it. Usage: npm run download [-- --commit <sha>]
import { createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { fileExists, findInvalidUtf8, gitBlobIdOf, sha256Of } from './files.js';
import { rawDir as defaultRawDir, relativeToRepo } from './paths.js';
import { formatNumber } from './reports.js';
import { dataDateFromCommit, FILE_NAME, findCommit, findUpstreamChecksums, rawFileUrl, SOURCE } from './upstream.js';

export function snapshotBaseName(dataDate, shortSha) {
  return `retraction_watch-${dataDate}-${shortSha}`;
}

async function readFirstLine(file) {
  const handle = await open(file);
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(4096), 0, 4096, 0);
    return buffer.toString('utf8', 0, bytesRead).split('\n')[0];
  } finally {
    await handle.close();
  }
}

// Upstream's second export starts with a UTF-8 byte-order mark (spec 003, AC23).
// The file is saved with it, and DuckDB skips it when reading.
const withoutByteOrderMark = (line) => line.replace(/^﻿/, '');

// Writes characters in Unicode's control and format categories, such as a
// byte-order mark, as \uXXXX, so an error message doesn't hide them (AC23).
const showInvisible = (text) =>
  text.replace(/[\p{Cc}\p{Cf}]/gu, (char) => `\\u${char.codePointAt(0).toString(16).padStart(4, '0')}`);

async function writeManifest(manifestPath, manifest) {
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

// Upstream has published files in Windows-1252 that lost text (spec 003, AC22).
// GitLab's SHA-256 can't be compared for such a file, so this says what's wrong.
function notUtf8Message({ count, firstLine }, upstreamBlobId) {
  const where = count === 1 ? `1 byte isn't, on line ${firstLine}` : `${formatNumber(count)} bytes aren't, the first on line ${firstLine}`;
  const sentences = [`Upstream's file isn't valid UTF-8: ${where}.`];
  if (upstreamBlobId) {
    sentences.push(
      `The download matches GitLab's file (git blob ${upstreamBlobId.slice(0, 8)}), so the problem is in upstream's file, not the download.`,
    );
  }
  sentences.push('See docs/data-issues.md#file-format.');
  return sentences.join(' ');
}

// Downloads the CSV at the given commit, or at the newest commit. `fetch` and
// `rawDir` can be replaced for tests.
export async function downloadSnapshot({
  commit: requestedSha,
  fetch: fetchImpl = globalThis.fetch,
  rawDir = defaultRawDir,
} = {}) {
  const commit = await findCommit(requestedSha, { fetch: fetchImpl });
  const dataDate = dataDateFromCommit(commit);
  const baseName = snapshotBaseName(dataDate, commit.short_id);
  const csvPath = path.join(rawDir, `${baseName}.csv`);
  const manifestPath = path.join(rawDir, `${baseName}.json`);
  const url = rawFileUrl(commit.id);
  const { blobId: upstreamBlobId, sha256: upstreamSha256 } = await findUpstreamChecksums(commit.id, { fetch: fetchImpl });
  const manifest = {
    source: SOURCE,
    file: FILE_NAME,
    commit: commit.id,
    short_commit: commit.short_id,
    commit_title: commit.title,
    committed_at: commit.committed_date,
    data_date: dataDate,
    url,
  };

  await mkdir(rawDir, { recursive: true });

  if ((await fileExists(csvPath)) && (await sha256Of(csvPath)) === upstreamSha256) {
    if (!(await fileExists(manifestPath))) {
      const { size, mtime } = await stat(csvPath);
      await writeManifest(manifestPath, {
        ...manifest,
        downloaded_at: mtime.toISOString(),
        bytes: size,
        sha256: upstreamSha256,
      });
    }
    return { csvPath, manifestPath, dataDate, commit: commit.short_id, fullCommit: commit.id, skipped: true };
  }

  const partialPath = `${csvPath}.partial`;
  try {
    const response = await fetchImpl(url);
    if (!response.ok || !response.body) {
      throw new Error(`Download failed with status ${response.status}: ${url}`);
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partialPath));

    const { size } = await stat(partialPath);
    if (size === 0) {
      throw new Error(`The downloaded file is empty: ${url}`);
    }
    const header = await readFirstLine(partialPath);
    if (!withoutByteOrderMark(header).startsWith('Record ID,')) {
      throw new Error(`The downloaded file doesn't start with the expected header: "${showInvisible(header.slice(0, 80))}"`);
    }
    const blobId = await gitBlobIdOf(partialPath);
    if (upstreamBlobId && blobId !== upstreamBlobId) {
      throw new Error(`The download doesn't match GitLab's file: git blob ${blobId}, GitLab reports ${upstreamBlobId}`);
    }
    const invalid = findInvalidUtf8(await readFile(partialPath));
    if (invalid) {
      throw new Error(notUtf8Message(invalid, upstreamBlobId));
    }
    const sha256 = await sha256Of(partialPath);
    if (upstreamSha256 && sha256 !== upstreamSha256) {
      throw new Error(`Checksum mismatch: downloaded ${sha256}, GitLab reports ${upstreamSha256}`);
    }

    await rename(partialPath, csvPath);
    await writeManifest(manifestPath, {
      ...manifest,
      downloaded_at: new Date().toISOString(),
      bytes: size,
      sha256,
    });
    return { csvPath, manifestPath, dataDate, commit: commit.short_id, fullCommit: commit.id, skipped: false };
  } finally {
    await rm(partialPath, { force: true });
  }
}

async function main() {
  const { values } = parseArgs({ options: { commit: { type: 'string' } } });
  const result = await downloadSnapshot({ commit: values.commit });
  const file = relativeToRepo(result.csvPath);
  if (result.skipped) {
    console.log(`Already have ${file} (checksum matches GitLab's), so skipped the download.`);
  } else {
    console.log(`Saved ${file}: data for ${result.dataDate}, upstream commit ${result.commit}.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
