// A small client for Typesense's HTTP API, using the admin key.
export class TypesenseError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Returns request(method, path, { body, query, text }). A body that's a string
// is sent as is (for JSON lines); anything else is sent as JSON. Responses are
// parsed as JSON unless `text` is set.
export function typesenseClient({ url, key }) {
  return async function request(method, pathname, { body, query, text = false } = {}) {
    const target = new URL(pathname, url);
    for (const [name, value] of Object.entries(query ?? {})) {
      target.searchParams.set(name, String(value));
    }
    let response;
    try {
      response = await fetch(target, {
        method,
        headers: { 'X-TYPESENSE-API-KEY': key, 'Content-Type': 'application/json' },
        body: body === undefined || typeof body === 'string' ? body : JSON.stringify(body),
      });
    } catch (error) {
      throw new TypesenseError(`Can't reach Typesense at ${url} (${error.cause?.code ?? error.message}). Is it running? Start it with npm run search:up.`);
    }
    const content = await response.text();
    if (!response.ok) {
      let message = content;
      try {
        message = JSON.parse(content).message ?? content;
      } catch {
        // Not JSON: keep the text.
      }
      throw new TypesenseError(`Typesense ${method} ${pathname} failed with HTTP ${response.status}: ${message}`, response.status);
    }
    return text ? content : JSON.parse(content);
  };
}
