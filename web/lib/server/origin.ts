import 'server-only';
import { headers } from 'next/headers';

// The address visitors used to reach the site, for links that leave it, such
// as a GitHub issue that quotes the page's link.
export async function siteOrigin(): Promise<string> {
  const list = await headers();
  const host = list.get('x-forwarded-host') ?? list.get('host') ?? 'localhost:3000';
  const protocol = list.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${protocol}://${host}`;
}
