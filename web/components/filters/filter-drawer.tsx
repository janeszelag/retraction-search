'use client';

// On phones the filters fold behind a Filters button (plan 002, "Layout"). The
// drawer is a Radix dialog, which keeps keyboard focus inside it while open
// and returns it to the button on close (decision record 003).
import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { CloseIcon } from '@/components/icons';
import { ui } from '@/components/ui';

export function FilterDrawer({ children, active }: { children: ReactNode; active: number }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger className={`${ui.btn} self-start cols:hidden`}>
        Filters{active > 0 ? ` (${active})` : ''}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgba(22,25,29,0.4)]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-50 flex w-[min(100%,380px)] flex-col bg-white shadow-xl focus:outline-none"
        >
          <div className="flex items-center justify-between border-b border-ink-150 px-4 py-3">
            <Dialog.Title className="text-base font-bold">Filters</Dialog.Title>
            <Dialog.Close className={ui.chipRemove} aria-label="Close filters">
              <CloseIcon size={14} />
            </Dialog.Close>
          </div>
          {/* The dialog's own title already says Filters. */}
          <div className="flex-1 overflow-y-auto px-4 pb-6 [&_.filters-heading]:hidden">{children}</div>
          <div className="border-t border-ink-150 px-4 py-3">
            <Dialog.Close className={`${ui.btnPrimary} w-full justify-center`}>Show results</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
