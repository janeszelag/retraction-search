'use client';

// A dropdown in the site's own style instead of the browser's built-in list.
// Radix Select keeps what a native select gives for free: keyboard use (arrow
// keys, typing a letter, Escape), focus handling and screen-reader roles.
import { Select } from 'radix-ui';
import { ChevronDownIcon } from '@/components/icons';

export interface MenuOption {
  value: string;
  label: string;
  disabled?: boolean;
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 6.4l2.6 2.6L10 3.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SelectMenu({
  value,
  onValueChange,
  options,
  label,
  id,
  className = '',
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: MenuOption[];
  // Read by screen readers when there's no visible label.
  label?: string;
  // Lets a visible <label htmlFor> name the menu.
  id?: string;
  className?: string;
}) {
  return (
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger
        id={id}
        aria-label={label}
        className={`inline-flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-md border border-ink-400 bg-white px-3 text-left hover:border-ink-500 data-[state=open]:border-accent ${className}`}
      >
        <Select.Value />
        <Select.Icon className="text-ink-700">
          <ChevronDownIcon />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-ink-200 bg-white py-1 shadow-lg"
        >
          <Select.Viewport>
            {options.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="relative flex min-h-9 cursor-pointer items-center py-1.5 pr-3 pl-8 text-sm outline-none select-none data-[disabled]:cursor-default data-[disabled]:text-ink-400 data-[highlighted]:bg-accent-soft data-[state=checked]:font-semibold"
              >
                <Select.ItemIndicator className="absolute left-2.5 text-accent">
                  <CheckIcon />
                </Select.ItemIndicator>
                <Select.ItemText>{option.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
