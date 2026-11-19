import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-xl bg-panel/95 shadow-panel backdrop-blur', className)}>{children}</div>;
}

export function Divider({ vertical }: { vertical?: boolean }) {
  return <div className={vertical ? 'mx-1 h-6 w-px bg-line' : 'my-1 h-px w-6 bg-line'} />;
}

interface IconButtonProps {
  icon: IconName;
  label: string;
  hint?: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  tooltip?: 'top' | 'bottom' | 'right';
  onClick: () => void;
}

const tooltipPosition = {
  top: 'bottom-full left-1/2 mb-2 -translate-x-1/2',
  bottom: 'top-full left-1/2 mt-2 -translate-x-1/2',
  right: 'left-full top-1/2 ml-3 -translate-y-1/2',
};

export function IconButton({ icon, label, hint, active, danger, disabled, tooltip = 'bottom', onClick }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'group relative grid h-9 w-9 place-items-center rounded-lg transition-colors duration-100',
        'disabled:cursor-not-allowed disabled:opacity-35',
        active ? 'bg-accent text-white shadow-[0_0_0_1px_rgba(255,255,255,0.12)]' : 'text-muted enabled:hover:bg-hover enabled:hover:text-ink',
        danger && !active && 'enabled:hover:bg-danger/15 enabled:hover:text-danger',
      )}
    >
      <Icon name={icon} />
      <span
        className={cx(
          'pointer-events-none absolute z-30 whitespace-nowrap rounded-md bg-raised px-2 py-1 text-xs font-medium text-ink opacity-0 shadow-panel transition-opacity delay-300 duration-100 group-hover:opacity-100',
          tooltipPosition[tooltip],
        )}
      >
        {label}
        {hint && <kbd className="ml-2 rounded bg-hover px-1.5 py-px font-sans text-[10px] text-muted">{hint}</kbd>}
      </span>
    </button>
  );
}

interface ChipProps {
  active?: boolean;
  title?: string;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}

export function Chip({ active, title, className, onClick, children }: ChipProps) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cx(
        'grid h-8 min-w-8 place-items-center rounded-lg px-2 text-sm transition-colors duration-100',
        active ? 'bg-hover text-ink shadow-[inset_0_0_0_1px_rgba(91,140,255,0.7)]' : 'text-muted hover:bg-hover hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  );
}

interface ButtonProps {
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

export function Button({ variant = 'ghost', disabled, onClick, children }: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-40',
        variant === 'primary' && 'bg-accent text-white enabled:hover:bg-accent/85',
        variant === 'ghost' && 'text-muted enabled:hover:bg-hover enabled:hover:text-ink',
        variant === 'danger' && 'bg-danger/15 text-danger enabled:hover:bg-danger/25',
      )}
    >
      {children}
    </button>
  );
}
