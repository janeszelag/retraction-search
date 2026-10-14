import type { Segment } from '@/lib/search/types';

// Matched words become <mark> elements; nothing is inserted as HTML.
export function Highlighted({ segments }: { segments: Segment[] }) {
  return segments.map((segment, index) => (segment.mark ? <mark key={index}>{segment.text}</mark> : <span key={index}>{segment.text}</span>));
}
