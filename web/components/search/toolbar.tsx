'use client';

// The toolbar above the results: sort, "Cite this search" and its panel, as
// in the prototype (spec 002 AC19, AC24).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ui } from '@/components/ui';

export function Toolbar({ sort, citation, download }: { sort: ReactNode; citation: string; download?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
  }, []);
  const flash = (text: string) => {
    setNote(text);
    if (timer.current) {
      clearTimeout(timer.current);
    }
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

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-y border-[#e3e6ea] py-2.5">
        {sort}
        <span className="flex-1" />
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={ui.btn}>
          Cite this search
        </button>
        {download}
      </div>
      <p role="status" className={note ? ui.note : 'sr-only'}>
        {note}
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
