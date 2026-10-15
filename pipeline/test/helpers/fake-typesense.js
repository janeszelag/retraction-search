// An in-memory stand-in for the parts of Typesense's API the pipeline uses,
// with the same request(method, path, { body, query, text }) shape as
// src/typesense.js. Every request is logged, so tests can check what was asked.
import { TypesenseError } from '../../src/typesense.js';

const FACET_VALUE_BYTES = 255;
const encoder = new TextEncoder();

// Typesense returns at most the first 255 bytes of a facet value.
function cutValue(value) {
  if (typeof value !== 'string' || encoder.encode(value).length <= FACET_VALUE_BYTES) {
    return value;
  }
  let cut = '';
  for (const character of value) {
    if (encoder.encode(cut + character).length > FACET_VALUE_BYTES) {
      break;
    }
    cut += character;
  }
  return cut;
}

// Typesense changes the order of keys inside object fields.
function reorderObjects(doc) {
  return Object.fromEntries(
    Object.entries(doc).map(([key, value]) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? [key, Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? 1 : -1)))]
        : [key, value],
    ),
  );
}

// Supports the filters the pipeline sends: clauses like `field:=value` joined by &&.
function matches(doc, filter) {
  if (!filter) {
    return true;
  }
  return filter.split('&&').every((clause) => {
    const [field, raw] = clause.trim().split(':=');
    const value = raw.trim().replace(/^`|`$/g, '');
    return [doc[field.trim()]].flat().some((entry) => String(entry) === value);
  });
}

export function fakeTypesense() {
  const collections = new Map(); // name → { schema, docs: Map(id → doc) }
  const aliases = new Map();
  const requests = [];
  const importBodies = [];
  const state = {
    collections,
    aliases,
    requests,
    importBodies,
    // Set to a function (doc, collectionName) → doc to change documents as they're stored,
    // as Typesense's import bug does. Return the doc unchanged to leave it.
    onImport: null,
    // Set to a function (method, pathname, collectionName) → Error, or null, to fail a request.
    failRequest: null,
    // Set to a function (query, result, collectionName) → result to change what a search returns.
    onSearch: null,
  };

  const notFound = (what) => new TypesenseError(`Typesense: ${what} not found`, 404);
  const resolve = (name) => aliases.get(name) ?? name;
  const collection = (name) => {
    const found = collections.get(resolve(name));
    if (!found) {
      throw notFound(`collection ${name}`);
    }
    return found;
  };

  async function request(method, pathname, { body, query = {} } = {}) {
    requests.push(`${method} ${pathname}`);
    const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const failure = state.failRequest?.(method, pathname, parts[1]);
    if (failure) {
      throw failure;
    }
    const json = typeof body === 'string' ? null : body;

    if (parts[0] === 'keys') {
      return method === 'GET' ? { keys: [] } : { id: 1, value: 'fake-key', value_prefix: 'fake' };
    }
    if (parts[0] === 'aliases') {
      if (method === 'GET') {
        if (!aliases.has(parts[1])) {
          throw notFound(`alias ${parts[1]}`);
        }
        return { name: parts[1], collection_name: aliases.get(parts[1]) };
      }
      if (method === 'PUT') {
        aliases.set(parts[1], json.collection_name);
        return { name: parts[1], collection_name: json.collection_name };
      }
    }
    if (parts[0] !== 'collections') {
      throw notFound(pathname);
    }
    if (parts.length === 1) {
      if (method === 'GET') {
        return [...collections.entries()].map(([name, c]) => ({ name, num_documents: c.docs.size }));
      }
      if (method === 'POST') {
        if (collections.has(json.name)) {
          throw new TypesenseError(`A collection with name ${json.name} already exists.`, 409);
        }
        collections.set(json.name, { schema: json, docs: new Map() });
        return json;
      }
    }
    const name = parts[1];
    if (parts.length === 2) {
      const found = collection(name);
      if (method === 'GET') {
        return { name: resolve(name), num_documents: found.docs.size };
      }
      if (method === 'DELETE') {
        collections.delete(resolve(name));
        return { name };
      }
    }
    const found = collection(name);
    const action = parts.slice(3).join('/');
    if (parts[2] !== 'documents') {
      throw notFound(pathname);
    }
    if (action === 'import' && method === 'POST') {
      importBodies.push(body);
      const results = body
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          let doc = JSON.parse(line);
          if (state.onImport) {
            doc = state.onImport(doc, resolve(name));
          }
          found.docs.set(String(doc.id), doc);
          return JSON.stringify({ success: true, id: String(doc.id) });
        });
      return results.join('\n');
    }
    if (action === 'export' && method === 'GET') {
      const lines = [...found.docs.values()].map((doc) => JSON.stringify(reorderObjects(doc)));
      return lines.join('\n');
    }
    if (action === 'search' && method === 'GET') {
      const hits = [...found.docs.values()].filter((doc) => matches(doc, query.filter_by));
      const facetFields = query.facet_by ? query.facet_by.split(',') : [];
      const result = {
        found: hits.length,
        hits: [],
        facet_counts: facetFields.map((field) => {
          const counts = new Map();
          for (const doc of hits) {
            for (const value of [doc[field] ?? []].flat()) {
              const key = cutValue(String(value));
              counts.set(key, (counts.get(key) ?? 0) + 1);
            }
          }
          return { field_name: field, counts: [...counts].map(([value, count]) => ({ value, count })) };
        }),
      };
      return state.onSearch ? state.onSearch(query, result, resolve(name)) : result;
    }
    if (action === '' && method === 'POST') {
      if (query.action === 'upsert' || !found.docs.has(String(json.id))) {
        found.docs.set(String(json.id), json);
        return json;
      }
    }
    if (parts.length === 4 && method === 'DELETE') {
      if (!found.docs.delete(parts[3])) {
        throw notFound(`document ${parts[3]}`);
      }
      return { id: parts[3] };
    }
    if (parts.length === 4 && method === 'GET') {
      const doc = found.docs.get(parts[3]);
      if (!doc) {
        throw notFound(`document ${parts[3]}`);
      }
      return doc;
    }
    throw notFound(`${method} ${pathname}`);
  }

  state.request = request;
  return state;
}
