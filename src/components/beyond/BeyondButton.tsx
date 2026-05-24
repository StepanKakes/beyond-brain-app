import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
// utils.js exports `cn`; resolved by Vite without extension
import { cn } from '../../lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'chip';
type Size = 'sm' | 'md' | 'lg';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  fullWidth?: boolean;
};

const BASE =
  'inline-flex items-center justify-center gap-2 font-medium rounded-full ' +
  'transition-[transform,box-shadow,background-color] duration-200 ease-out ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0 ' +
  'focus-visible:ring-beyond-dusk/30 select-none ' +
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none ' +
  'active:translate-y-0';

const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3.5 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-5 text-base',
};

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-beyond-charcoal text-white shadow-soft ' +
    'hover:-translate-y-px hover:shadow-glass-sm ' +
    'dark:bg-white dark:text-beyond-charcoal',
  secondary:
    'bg-glass-strong text-beyond-primary shadow-soft ' +
    'hover:-translate-y-px hover:shadow-glass',
  ghost:
    'bg-transparent text-beyond-secondary ' +
    'hover:bg-white/55 hover:text-beyond-primary ' +
    'dark:hover:bg-white/10',
  chip:
    'beyond-chip',
};

const BeyondButton = forwardRef<HTMLButtonElement, Props>(
  (
    {
      variant = 'secondary',
      size = 'md',
      leadingIcon,
      trailingIcon,
      fullWidth,
      className,
      children,
      ...rest
    },
    ref,
  ) => {
    const isChip = variant === 'chip';
    return (
      <button
        ref={ref}
        className={cn(
          BASE,
          !isChip && SIZE[size],
          VARIANT[variant],
          fullWidth && 'w-full',
          className,
        )}
        {...rest}
      >
        {leadingIcon ? <span className="-ml-0.5 inline-flex">{leadingIcon}</span> : null}
        {children}
        {trailingIcon ? <span className="-mr-0.5 inline-flex">{trailingIcon}</span> : null}
      </button>
    );
  },
);

BeyondButton.displayName = 'BeyondButton';
export default BeyondButton;
