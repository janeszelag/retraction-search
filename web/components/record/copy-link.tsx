'use client';

import { useEffect, useRef, useState } from 'react';
import { ui } from '@/components/ui';

function LinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M5.8 8.2l2.4-2.4M6.3 3.9l1.1-1.1a2.4 2.4 0 0 1 3.4 3.4l-1.1 1.1M7.7 10.1l-1.1 1.1a2.4 2.4 0 0 1-3.4-3.4l1.1-1.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// "Copy link to this record", with a short note that says what happened (spec 002 AC22).
export function CopyLink({ path }: { path: string }) {
  const [note, setNote] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
  }, []);
  const show = (text: string) => {
    setNote(text);
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => setNote(''), 7000);
  };
  const copy = async () => {
    const link = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(link);
      show('Link copied.');
    } catch {
      show(`Copying is blocked here. The link is ${link}`);
    }
  };
  return (
    <>
      <button type="button" onClick={copy} className={ui.btn}>
        <LinkIcon />
        Copy link to this record
      </button>
      <p role="status" className={note ? `${ui.note} basis-full break-words` : 'sr-only'}>
        {note}
      </p>
    </>
  );
}
