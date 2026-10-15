// The CSV download (spec 002 AC23, task 18). Server-only, like the client it uses.
//
// The file streams: each batch of records becomes CSV lines and goes to the
// visitor as soon as Typesense sends it, so the server never holds the whole
// file. Once the first bytes are out, the response can't change its status, so
// a failure partway through ends the stream with an error. The browser then
// reports a failed download instead of saving a file that looks complete but isn't.
import 'server-only';
import { EXPORT_PER_PAGE, toExportPlan, type ExportPlan } from '../query/export';
import type { TypesenseSearch } from '../query/typesense';
import type { Query } from '../query/types';
import { BOM, EXPORT_FIELDS, csvFileName, csvHeader, csvRow } from '../search/csv';
import type { TypesenseResult } from '../search/parse';
import { loadMeta, logFailure } from './search';
import { typesenseClient, type TypesenseClient } from './typesense';

type Document = Record<string, unknown>;

export type ExportStart = { status: 'ok'; fileName: string; total: number; body: ReadableStream<Uint8Array> } | { status: 'unavailable' };

interface Options {
  client?: TypesenseClient;
  // Aborts when the visitor cancels the download.
  signal?: AbortSignal;
}

function checked(result: TypesenseResult | undefined, what: string): TypesenseResult {
  if (!result || result.error) {
    throw new Error(`Typesense refused ${what}: ${result?.error ?? 'no result'}`);
  }
  return result;
}

// The page's total, with the page's close-spellings fallback, so the file holds
// the records the page counted (spike S6).
async function count(query: Query, client: TypesenseClient): Promise<{ plan: ExportPlan; total: number }> {
  let plan = toExportPlan(query);
  const [main, exact] = await client.multiSearch(plan.exact ? [plan.count, plan.exact] : [plan.count]);
  let total = checked(main, 'the count').found ?? 0;
  if (plan.exact && checked(exact, 'the exact count').found === 0 && total > 0) {
    plan = toExportPlan(query, { typos: 'always' });
    const [again] = await client.multiSearch([plan.count]);
    total = checked(again, 'the count').found ?? 0;
  }
  return { plan, total };
}

// Typesense's export endpoint sends JSON lines in chunks that can end partway through a line.
async function* exportedBatches(body: ReadableStream<Uint8Array>): AsyncGenerator<Document[]> {
  const reader = body.getReader();
  // A chunk can also end partway through a character, which `stream: true` holds for the next one.
  const decoder = new TextDecoder();
  let rest = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      const lines = (rest + decoder.decode(value, { stream: true })).split('\n');
      rest = lines.pop() ?? '';
      yield lines.filter((line) => line.trim()).map((line) => JSON.parse(line) as Document);
    }
    rest += decoder.decode();
    if (rest.trim()) {
      yield [JSON.parse(rest) as Document];
    }
  } finally {
    // Stops reading from Typesense if the visitor cancels.
    await reader.cancel().catch(() => {});
  }
}

// With search text, the records come a page at a time, in the page's order.
async function* pagedBatches(client: TypesenseClient, page: (number: number) => TypesenseSearch, total: number): AsyncGenerator<Document[]> {
  for (let number = 1; (number - 1) * EXPORT_PER_PAGE < total; number += 1) {
    const result = checked((await client.multiSearch([page(number)]))[0], `page ${number} of the download`);
    // A new snapshot loaded during the download.
    if (result.found !== total) {
      throw new Error(`The search found ${result.found} records on page ${number}, not ${total}.`);
    }
    yield (result.hits ?? []).map((hit) => hit.document);
  }
}

async function* csvChunks(batches: AsyncGenerator<Document[]>, total: number, siteOrigin: string): AsyncGenerator<string> {
  yield BOM + csvHeader();
  const seen = new Set<number>();
  // Leaving the loop early, on a cancel or an error, also stops the batches.
  for await (const batch of batches) {
    for (const doc of batch) {
      const id = Number(doc.record_id);
      if (seen.has(id)) {
        throw new Error(`Record ${id} came twice.`);
      }
      seen.add(id);
    }
    if (batch.length > 0) {
      yield batch.map((doc) => csvRow(doc, siteOrigin)).join('');
    }
  }
  // The file holds the same records and count as the page (AC23).
  if (seen.size !== total) {
    throw new Error(`The download has ${seen.size} records, but the search found ${total}.`);
  }
}

function toStream(chunks: AsyncGenerator<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await chunks.next();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(encoder.encode(value));
        }
      } catch (error) {
        logFailure('A download', error);
        controller.error(error);
      }
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
}

// Checks that search is up and counts the records before any of the file is
// sent, so those failures can still get an error status.
export async function startExport(query: Query, siteOrigin: string, { client = typesenseClient, signal }: Options = {}): Promise<ExportStart> {
  try {
    const meta = await loadMeta(client);
    if (!meta) {
      return { status: 'unavailable' };
    }
    const { plan, total } = await count(query, client);
    const batches =
      plan.source.kind === 'export'
        ? exportedBatches(await client.exportDocuments({ filterBy: plan.source.filterBy, includeFields: EXPORT_FIELDS.join(','), signal }))
        : pagedBatches(client, plan.source.page, total);
    return { status: 'ok', fileName: csvFileName(meta.dataDate), total, body: toStream(csvChunks(batches, total, siteOrigin)) };
  } catch (error) {
    logFailure('Starting a download', error);
    return { status: 'unavailable' };
  }
}
