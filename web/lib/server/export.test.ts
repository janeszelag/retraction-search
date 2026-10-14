import { describe, expect, it } from 'vitest';
import metaDocument from '../search/fixtures/meta.json';
import { COLUMNS } from '../search/csv';
import type { TypesenseResult } from '../search/parse';
import type { TypesenseSearch } from '../query/typesense';
import { parseQuery } from '../query/url';
import { startExport } from './export';
import type { TypesenseClient } from './typesense';

const doc = (id: number) => ({ record_id: id, notice_type: 'Retraction', title: `Title ${id}`, authors: ['Maria Example', 'Jun Sample'] });

// A stream that sends the text's bytes in pieces, cut at the given byte offsets, as the network might.
function streamOf(text: string, ...cuts: number[]): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  const ends = [...cuts, bytes.length];
  return new ReadableStream({
    start(controller) {
      ends.forEach((end, index) => controller.enqueue(bytes.slice(index === 0 ? 0 : ends[index - 1], end)));
      controller.close();
    },
  });
}

interface Fake {
  // Answers each multi_search: the count first, then any pages.
  answer: (searches: TypesenseSearch[]) => TypesenseResult[];
  exported?: () => ReadableStream<Uint8Array>;
  meta?: () => Record<string, unknown>;
}

function fakeClient({ answer, exported, meta }: Fake) {
  const asked: TypesenseSearch[][] = [];
  const exports: { filterBy?: string; includeFields: string }[] = [];
  const client: TypesenseClient = {
    async multiSearch(searches) {
      asked.push(searches);
      return answer(searches);
    },
    async meta() {
      return meta ? meta() : (metaDocument as Record<string, unknown>);
    },
    async exportDocuments({ filterBy, includeFields }) {
      exports.push({ filterBy, includeFields });
      if (!exported) {
        throw new Error('no export expected');
      }
      return exported();
    },
  };
  return { client, asked, exports };
}

async function download(search: string, fake: Fake) {
  const { client, asked, exports } = fakeClient(fake);
  const result = await startExport(parseQuery(new URLSearchParams(search)), 'https://example.org', { client });
  return { result, asked, exports };
}

// The file as sent. Response.text() would drop the byte-order mark, so this keeps it.
const fileText = async (body: ReadableStream<Uint8Array>) =>
  new TextDecoder('utf-8', { ignoreBOM: true }).decode(await new Response(body).arrayBuffer());

// The file's data lines, keyed by column, for files whose cells need no quoting.
function rows(text: string) {
  const [header, ...lines] = text.split('\r\n').filter(Boolean);
  const names = header.replace(/^﻿/, '').split(',');
  return { header: names, rows: lines.map((line) => Object.fromEntries(line.split(',').map((cell, index) => [names[index], cell]))) };
}

const counted = (found: number, exactFound?: number) => (searches: TypesenseSearch[]) =>
  searches.map((search) => ({ found: search.num_typos === '0' ? (exactFound ?? found) : found, hits: [] }));

describe('CSV download (task 18, AC23)', () => {
  it('streams a filter-only search from the export endpoint, even when chunks split lines and characters', async () => {
    const all = [{ ...doc(1), countries: ['Côte d’Ivoire'] }, doc(2), doc(3)].map((entry) => JSON.stringify(entry)).join('\n');
    // The second cut falls inside the "ô", which takes two bytes.
    const inside = new TextEncoder().encode(all.slice(0, all.indexOf('ô'))).length + 1;
    const { result, asked, exports } = await download('reason=Manipulation+of+Images', {
      answer: counted(3),
      exported: () => streamOf(all, 10, inside, inside + 40),
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.fileName).toBe('retraction-search-2026-10-09.csv');
    expect(result.total).toBe(3);
    expect(asked).toHaveLength(1);
    expect(exports).toEqual([{ filterBy: asked[0][0].filter_by, includeFields: asked[0][0].include_fields }]);

    const text = await fileText(result.body);
    expect(text.startsWith('﻿record_id,')).toBe(true);
    const file = rows(text);
    expect(file.header).toEqual(COLUMNS.map(([name]) => name));
    expect(file.rows.map((row) => row.record_id)).toEqual(['1', '2', '3']);
    expect(file.rows[0]).toMatchObject({
      title: 'Title 1',
      author_names: 'Maria Example; Jun Sample',
      countries: 'Côte d’Ivoire',
      record_page: 'https://example.org/record/1',
    });
  });

  it('pages through a text search and writes every page', async () => {
    const total = 260;
    const { result, asked } = await download('q=neuron', {
      answer: (searches) =>
        searches.map((search) => {
          if (search.per_page === 0) return { found: total };
          const first = ((search.page ?? 1) - 1) * search.per_page;
          const ids = Array.from({ length: Math.min(search.per_page, total - first) }, (_, index) => first + index + 1);
          return { found: total, hits: ids.map((id) => ({ document: doc(id) })) };
        }),
    });
    if (result.status !== 'ok') throw new Error(result.status);
    const file = rows(await fileText(result.body));
    expect(file.rows).toHaveLength(total);
    expect(file.rows.at(-1)?.record_id).toBe('260');
    // The count and exact count, then two pages of 250.
    expect(asked.map((searches) => searches.map((search) => [search.page, search.per_page]))).toEqual([
      [
        [1, 0],
        [undefined, 0],
      ],
      [[1, 250]],
      [[2, 250]],
    ]);
  });

  it('downloads close spellings when the page showed them, with typos on for every search', async () => {
    const { result, asked } = await download('q=nuerons', {
      answer: (searches) =>
        searches.map((search) =>
          search.per_page === 0 ? { found: search.num_typos === '0' ? 0 : 1 } : { found: 1, hits: [{ document: doc(9) }] },
        ),
    });
    if (result.status !== 'ok') throw new Error(result.status);
    expect(rows(await fileText(result.body)).rows.map((row) => row.record_id)).toEqual(['9']);
    expect(asked).toHaveLength(3);
    expect(asked[1][0].typo_tokens_threshold).toBeGreaterThan(0);
    expect(asked[2][0].typo_tokens_threshold).toBe(asked[1][0].typo_tokens_threshold);
  });

  it('fails the file, rather than ending it early, when it holds fewer records than the page', async () => {
    const { result } = await download('', { answer: counted(3), exported: () => streamOf(`${JSON.stringify(doc(1))}\n`) });
    if (result.status !== 'ok') throw new Error(result.status);
    await expect(new Response(result.body).text()).rejects.toThrow();
  });

  it('fails the file when a record comes twice', async () => {
    const line = `${JSON.stringify(doc(1))}\n`;
    const { result } = await download('', { answer: counted(2), exported: () => streamOf(line + line, line.length) });
    if (result.status !== 'ok') throw new Error(result.status);
    await expect(new Response(result.body).text()).rejects.toThrow();
  });

  it('says search is unavailable when Typesense fails before the file starts (AC29)', async () => {
    const down = () => {
      throw new Error('connection refused');
    };
    expect((await download('', { answer: down })).result).toEqual({ status: 'unavailable' });
    expect((await download('', { answer: counted(3), meta: down })).result).toEqual({ status: 'unavailable' });
    expect((await download('', { answer: counted(3) })).result).toEqual({ status: 'unavailable' });
    expect((await download('', { answer: () => [{ error: 'Could not parse the filter query.' }] })).result).toEqual({ status: 'unavailable' });
  });
});
