import type { Metadata } from 'next';
import { NotFoundMessage } from '@/components/not-found-message';

// Any address the site doesn't have, and any notFound() outside a segment
// with its own not-found file.
export const metadata: Metadata = { title: 'Page not found · Retraction search' };

export default function NotFound() {
  return <NotFoundMessage title="Page not found">There’s no page at this address. Check the link, or start a new search.</NotFoundMessage>;
}
