import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface PebbleSelectOption {
  value: string;
  label: string;
}

export interface PebbleSelectProps {
  value: string;
  options: PebbleSelectOption[];
  onChange: (value: string) => void;
  icon?: LucideIcon;
  ariaLabel?: string;
  className?: string;
  menuClassName?: string;
}

/**
 * Dropdown styled as a glass pebble. A native <select> cannot be used here:
 * the open list is painted by the OS, so it can never carry the frosted
 * surface, blur and border highlights the design calls for.
 */
export function PebbleSelect({
  value,
  options,
  onChange,
  icon: Icon,
  ariaLabel,
  className,
  menuClassName,
}: PebbleSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((opt) => opt.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn('pebble-select', className)}>
      <button
        type="button"
        className={cn('pebble-select-trigger', open && 'is-open')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
      >
        {Icon ? <Icon size={14} className="pebble-select-icon" /> : null}
        <span className="pebble-select-value">{selected?.label}</span>
        <ChevronDown size={14} className={cn('pebble-select-chevron', open && 'is-open')} />
      </button>

      {open && (
        <ul className={cn('pebble-select-menu', menuClassName)} role="listbox" aria-label={ariaLabel}>
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={cn('pebble-select-option', isSelected && 'is-selected')}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  <span>{opt.label}</span>
                  {isSelected && <Check size={13} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
