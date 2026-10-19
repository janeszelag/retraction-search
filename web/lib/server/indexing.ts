// The indexing switch (spec 004 AC10). Until SITE_INDEXING is "on", robots.txt
// disallows everything and every page carries noindex, nofollow, so the live
// site stays out of search engines until it's announced. Vercel applies a
// changed variable on the next deployment, so turning it on takes a redeploy.
import 'server-only';
import type { Metadata, MetadataRoute } from 'next';

export function indexingOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.SITE_INDEXING === 'on';
}

// What robots.txt says.
export function robotsRules(env: Record<string, string | undefined> = process.env): MetadataRoute.Robots {
  return { rules: indexingOn(env) ? { userAgent: '*', allow: '/' } : { userAgent: '*', disallow: '/' } };
}

// The robots meta tag every page gets from the root layout. Without one,
// search engines may index a page and follow its links.
export function robotsMeta(env: Record<string, string | undefined> = process.env): Metadata['robots'] {
  return indexingOn(env) ? undefined : { index: false, follow: false };
}
