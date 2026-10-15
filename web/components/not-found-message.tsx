import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/page-header';
import { ui } from '@/components/ui';
import { getMeta } from '@/lib/server/search';

// A 404 page's content, rendered on the server inside the site's layout, so
// the header, the message and the footer are in the HTML without JavaScript.
export async function NotFoundMessage({ title, children }: { title: string; children: ReactNode }) {
  const meta = await getMeta();
  return (
    <>
      <PageHeader dataDate={meta?.dataDate ?? null} />
      <main className={`${ui.wrap} pt-6 pb-12`}>
        <div className="flex max-w-[720px] flex-col gap-3 py-8">
          <h1 className="text-2xl font-extrabold">{title}</h1>
          <p className="text-ink-800">{children}</p>
          <div className="mt-1 flex gap-2.5">
            <Link href="/" className={ui.btnPrimary}>
              Go to the search
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
