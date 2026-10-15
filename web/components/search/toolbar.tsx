'use client';

// The toolbar above the results: sort, "Cite this search" and its panel, and
// "Download CSV", as in the prototype (spec 002 AC19, AC23, AC24, AC28).
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { DownloadIcon } from '@/components/icons';
import { ui } from '@/components/ui';
import { formatClockTime, formatPeriod } from '@/lib/rate-limit';

const DOWNLOAD_UNAVAILABLE = 'Search is unavailable right now, so the file can’t be made. Try again in a few minutes.';
const DOWNLOAD_FAILED = 'The download stopped before the file was complete. Try again.';

// retraction-search-2026-10-09.csv, from `attachment; filename="…"`.
function fileName(disposition: string | null): string {
  return disposition?.match(/filename="([^"]+)"/)?.[1] ?? 'retraction-search.csv';
}

// Over the download limit: when the visitor can download again, and the limit to state.
interface DownloadLimit {
  until: number;
  max: number;
  windowSeconds: number;
}

async function readLimit(response: Response): Promise<DownloadLimit> {
  const body = (await response.json().catch(() => ({}))) as { max?: number; windowSeconds?: number };
  const retryAfter = Number(response.headers.get('Retry-After')) || 3600;
  return { until: Date.now() + retryAfter * 1000, max: body.max ?? 6, windowSeconds: body.windowSeconds ?? 3600 };
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
  const [limit, setLimit] = useState<DownloadLimit | null>(null);
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
  // The button works again once the limit's window ends.
  useEffect(() => {
    if (!limit) {
      return;
    }
    const wait = setTimeout(() => setLimit(null), Math.max(0, limit.until - Date.now()));
    return () => clearTimeout(wait);
  }, [limit]);
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
    if (!downloadHref || downloading || limit) {
      return;
    }
    const controller = new AbortController();
    download.current = controller;
    setDownloading(true);
    show('Preparing the file…');
    try {
      const response = await fetch(downloadHref, { signal: controller.signal });
      if (response.status === 429) {
        show('');
        setLimit(await readLimit(response));
        return;
      }
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
          <a
            href={downloadHref}
            onClick={startDownload}
            aria-disabled={downloading || Boolean(limit) || undefined}
            className={`${ui.btnPrimary} ${limit ? 'cursor-default opacity-50' : downloading ? 'cursor-progress opacity-70' : ''}`}
          >
            <DownloadIcon />
            Download CSV
          </a>
        )}
      </div>
      {limit && (
        <div role="status" className="rounded-lg border border-accent-line bg-accent-soft px-4 py-3.5 text-[#1b3f6e]">
          <p className="font-bold">Download limit reached</p>
          <p className="mt-1 text-sm">
            Each visitor can download {limit.max} files per {formatPeriod({ max: limit.max, windowSeconds: limit.windowSeconds })}. You can download again
            at {formatClockTime(new Date(limit.until))}. Searching still works.
          </p>
        </div>
      )}
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
