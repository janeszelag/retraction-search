'use client';

// The toolbar above the results: sort, "Cite this search" and its panel, and
// "Download CSV", as in the prototype (spec 002 AC19, AC23, AC24).
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { DownloadIcon } from '@/components/icons';
import { ui } from '@/components/ui';

const DOWNLOAD_UNAVAILABLE = 'Search is unavailable right now, so the file can’t be made. Try again in a few minutes.';
const DOWNLOAD_FAILED = 'The download stopped before the file was complete. Try again.';

// retraction-search-2026-10-09.csv, from `attachment; filename="…"`.
function fileName(disposition: string | null): string {
  return disposition?.match(/filename="([^"]+)"/)?.[1] ?? 'retraction-search.csv';
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Some browsers start reading the file only after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function Toolbar({ sort, citation, downloadHref }: { sort: ReactNode; citation: string; downloadHref?: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [downloading, setDownloading] = useState(false);
  // Megabytes received so far. Shown, but not announced, so a screen reader hears only the start and the end.
  const [received, setReceived] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const download = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
      download.current?.abort();
    },
    [],
  );
  // A note that stays until the next one.
  const show = (text: string) => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    setNote(text);
  };
  const flash = (text: string) => {
    show(text);
    timer.current = setTimeout(() => setNote(''), 7000);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(citation);
      flash('Citation copied.');
    } catch {
      flash('Copying is blocked here. Select the text instead.');
    }
  };

  // The link works on its own, without JavaScript. With it, the page fetches
  // the file itself, so a failure shows here instead of replacing the page.
  const startDownload = async (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (!downloadHref || downloading) {
      return;
    }
    const controller = new AbortController();
    download.current = controller;
    setDownloading(true);
    show('Preparing the file…');
    try {
      const response = await fetch(downloadHref, { signal: controller.signal });
      if (!response.ok || !response.body) {
        flash(response.status === 503 ? DOWNLOAD_UNAVAILABLE : DOWNLOAD_FAILED);
        return;
      }
      const reader = response.body.getReader();
      const parts: Uint8Array<ArrayBuffer>[] = [];
      let bytes = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        parts.push(value);
        bytes += value.byteLength;
        setReceived(Math.floor(bytes / 1e6));
      }
      const name = fileName(response.headers.get('Content-Disposition'));
      save(new Blob(parts, { type: 'text/csv;charset=utf-8' }), name);
      flash(`Downloaded ${name}.`);
    } catch {
      if (!controller.signal.aborted) {
        flash(DOWNLOAD_FAILED);
      }
    } finally {
      download.current = null;
      setDownloading(false);
      setReceived(null);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-y border-[#e3e6ea] py-2.5">
        {sort}
        <span className="flex-1" />
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={ui.btn}>
          Cite this search
        </button>
        {downloadHref && (
          <a href={downloadHref} onClick={startDownload} aria-disabled={downloading || undefined} className={`${ui.btnPrimary} ${downloading ? 'cursor-progress opacity-70' : ''}`}>
            <DownloadIcon />
            Download CSV
          </a>
        )}
      </div>
      <p role="status" className={note ? ui.note : 'sr-only'}>
        {note}
        {downloading && Boolean(received) && <span aria-hidden="true"> {received} MB so far.</span>}
      </p>
      {open && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-[#c9d0d8] bg-ink-25 p-4">
          <p className="text-sm font-bold">Citation for this search</p>
          <p className="text-sm leading-normal break-words select-all">{citation}</p>
          <div className="flex items-center gap-3">
            <button type="button" onClick={copy} className={ui.btn}>
              Copy
            </button>
            <button type="button" onClick={() => setOpen(false)} className={ui.link}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
