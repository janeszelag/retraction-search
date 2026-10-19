// GET /robots.txt. Next.js builds it once, at build time, so a changed
// SITE_INDEXING takes effect with the next deployment (spec 004 AC10).
import type { MetadataRoute } from 'next';
import { robotsRules } from '@/lib/server/indexing';

export default function robots(): MetadataRoute.Robots {
  return robotsRules();
}
