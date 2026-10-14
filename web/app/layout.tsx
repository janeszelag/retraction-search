import type { Metadata } from 'next';
import { IBM_Plex_Mono, Public_Sans } from 'next/font/google';
import { connection } from 'next/server';
import { NavigationMemory } from '@/components/navigation-memory';
import { SiteFooter } from '@/components/site-footer';
import { formatDataDate } from '@/lib/format/dates';
import { issueUrl } from '@/lib/links';
import { getMeta } from '@/lib/server/search';
import './globals.css';

// next/font downloads the fonts at build time and serves them from this site,
// so visitors' browsers never contact Google.
const publicSans = Public_Sans({ subsets: ['latin', 'latin-ext'], variable: '--font-public-sans' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin', 'latin-ext'], weight: ['400', '500'], variable: '--font-plex-mono' });

export const metadata: Metadata = {
  title: 'Retraction search',
  description: 'A faceted search over the Retraction Watch database.',
};

// A server component: it runs on the server for every request, reads the data
// date from Typesense, and sends only the finished HTML to the browser.
async function Footer() {
  // Read at request time, not once at build time, so a new snapshot shows without a rebuild.
  await connection();
  const meta = await getMeta();
  return (
    <SiteFooter
      snapshot={meta}
      issueHref={issueUrl({ title: 'Problem with this site', dataDate: meta ? formatDataDate(meta.dataDate) : undefined })}
    />
  );
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${publicSans.variable} ${plexMono.variable}`}>
      <body className="flex min-h-screen flex-col">
        <NavigationMemory />
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
