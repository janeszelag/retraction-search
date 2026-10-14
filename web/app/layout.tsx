import type { Metadata } from 'next';
import { IBM_Plex_Mono, Public_Sans } from 'next/font/google';
import { SiteFooter } from '@/components/site-footer';
import { issueUrl } from '@/lib/links';
import './globals.css';

// next/font downloads the fonts at build time and serves them from this site,
// so visitors' browsers never contact Google.
const publicSans = Public_Sans({ subsets: ['latin', 'latin-ext'], variable: '--font-public-sans' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin', 'latin-ext'], weight: ['400', '500'], variable: '--font-plex-mono' });

export const metadata: Metadata = {
  title: 'Retraction search',
  description: 'A faceted search over the Retraction Watch database.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${publicSans.variable} ${plexMono.variable}`}>
      <body className="flex min-h-screen flex-col">
        <div className="flex-1">{children}</div>
        {/* The snapshot details come from Typesense's meta document once the server reads it (task 10). */}
        <SiteFooter snapshot={null} issueHref={issueUrl({ title: 'Problem with this site' })} />
      </body>
    </html>
  );
}
