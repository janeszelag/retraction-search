// The indexing switch (spec 004 AC10, AC15). Until SITE_INDEXING is "on",
// robots.txt disallows everything and every page carries noindex, nofollow, so
// the live site stays out of search engines until it's announced. Once it's on,
// only the start page and the About page may be indexed. Vercel applies a
// changed variable on the next deployment, so turning it on takes a redeploy.
import 'server-only';
import type { Metadata, MetadataRoute } from 'next';
import { parseQuery, queryHref, type SearchParamsInput } from '@/lib/query/url';

type Env = Record<string, string | undefined>;

export function indexingOn(env: Env = process.env): boolean {
  return env.SITE_INDEXING === 'on';
}

// What robots.txt says. Once indexing is on it disallows only /api/: results
// and record pages stay crawlable, since a search engine has to fetch a page
// to read its noindex, and may list a disallowed address it finds through links.
export function robotsRules(env: Env = process.env): MetadataRoute.Robots {
  return { rules: indexingOn(env) ? { userAgent: '*', allow: '/', disallow: '/api/' } : { userAgent: '*', disallow: '/' } };
}

// The robots meta tag every page gets from the root layout, with indexing on
// or off. Without one, search engines may index a page and follow its links.
// nofollow keeps crawlers off the filter links, where every combination is a
// new address and a new search.
export const NOT_INDEXED: Metadata['robots'] = { index: false, follow: false };

// Metadata for the two pages search engines may index once indexing is on,
// overriding the layout's tag. While it's off, it leaves robots out entirely,
// so the layout's noindex stays.
export function indexedMetadata(env: Env = process.env): Metadata {
  return indexingOn(env) ? { robots: { index: true, follow: true } } : {};
}

// The search page counts as the start page when its query has nothing set:
// any search, filter, sort or page makes it a results page, which stays out.
export function searchPageMetadata(searchParams: SearchParamsInput, env: Env = process.env): Metadata {
  return queryHref(parseQuery(searchParams)) === '/' ? indexedMetadata(env) : {};
}
