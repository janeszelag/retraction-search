// Class names for the prototype's recurring controls, so pages share one look.

export const ui = {
  // The page width and side padding (16px on phones, 24px wider).
  wrap: 'mx-auto w-full max-w-[1440px] px-4 cols:px-6',
  // The filter column beside the results, stacked on phones.
  cols: 'flex flex-col gap-4 cols:flex-row cols:gap-10',
  sideCol: 'w-full min-w-0 cols:w-[340px] cols:flex-none',
  mainCol: 'w-full min-w-0 flex-1',
  btn: 'inline-flex min-h-10 items-center gap-1.5 rounded-md border border-ink-300 bg-white px-3.5 text-sm font-semibold text-ink-950 no-underline hover:bg-ink-50 hover:text-ink-950',
  btnPrimary:
    'inline-flex min-h-10 items-center gap-1.5 rounded-md border border-accent bg-accent px-3.5 text-sm font-semibold text-white no-underline hover:bg-accent-hover hover:text-white',
  btnDisabled: 'inline-flex min-h-10 items-center rounded-md border border-ink-300 bg-white px-3.5 text-sm font-semibold text-ink-950 opacity-45',
  link: 'inline-flex min-h-8 items-center py-1 text-sm font-semibold text-accent underline underline-offset-2',
  input: 'min-h-10 w-full rounded-md border border-ink-400 bg-white px-3',
  chip: 'inline-flex items-center gap-0.5 rounded-full border border-accent-line bg-accent-soft py-0.5 pr-0.5 pl-3 text-sm leading-[1.3]',
  chipFixed: 'inline-flex items-center rounded-full border border-ink-200 bg-ink-50 px-3 py-0.5 text-sm leading-[1.3]',
  chipRemove: 'grid h-[30px] w-[30px] flex-none place-items-center rounded-full text-ink-700 hover:bg-[rgba(22,25,29,0.09)] hover:text-ink-700',
  tag: 'inline-block rounded border px-2 py-px text-xs leading-normal font-bold',
  note: 'rounded-md bg-accent-soft px-3.5 py-2.5 text-sm text-[#1b3f6e]',
} as const;
