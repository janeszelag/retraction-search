import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import defaultView from '../search/fixtures/default.json';
import metaDocument from '../search/fixtures/meta.json';
import type { TypesenseResult } from '../search/parse';
import { toTypesense } from '../query/typesense';
import { parseQuery } from '../query/url';
import { checkHealth } from './health';
import { SearchUnavailableError, type TypesenseClient } from './typesense';

// A client with the recorded default view and meta document, which can fail either read.
function client({ metaFails = false, searchFails = false } = {}) {
  const asked: unknown[] = [];
  const fake: TypesenseClient = {
    async multiSearch(searches) {
      asked.push(searches);
      if (searchFails) {
        throw new SearchUnavailableError("Typesense can't be reached at http://127.0.0.1:9: fetch failed");
      }
      return defaultView.results as TypesenseResult[];
    },
    async meta() {
      if (metaFails) {
        throw new SearchUnavailableError("Typesense can't be reached at http://127.0.0.1:9: fetch failed");
      }
      return metaDocument as Record<string, unknown>;
    },
    async exportDocuments() {
      throw new Error('the health check never exports');
    },
  };
  return { fake, asked };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('health check (spec 004, task 5, AC9)', () => {
  it('answers with the data date and the default view’s total, from the start page’s own search', async () => {
    const { fake, asked } = client();
    expect(await checkHealth(fake)).toEqual({ ok: true, dataDate: '2026-10-09', total: 67384 });
    expect(asked).toEqual([toTypesense(parseQuery(new URLSearchParams(''))).searches]);
  });

  it('answers not ok when the meta document can’t be read, without searching', async () => {
    const { fake, asked } = client({ metaFails: true });
    expect(await checkHealth(fake)).toEqual({ ok: false });
    expect(asked).toHaveLength(0);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Reading the data date failed'));
  });

  it('answers not ok when the search fails', async () => {
    const { fake } = client({ searchFails: true });
    expect(await checkHealth(fake)).toEqual({ ok: false });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Search failed'));
  });
});
