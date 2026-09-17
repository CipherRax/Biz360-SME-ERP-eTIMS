import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-sans font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-brand text-white hover:bg-brand-hover shadow-sm',
        secondary: 'border border-ink-300 bg-white text-ink-700 hover:bg-ink-100',
        outline: 'border border-brand bg-transparent text-brand hover:bg-brand-soft',
        ghost: 'text-ink-700 hover:bg-ink-100',
        danger: 'bg-error text-white hover:brightness-95 shadow-sm',
        link: 'text-brand underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-11 px-5 text-sm',
        lg: 'h-12 px-6 text-base',
        icon: 'h-10 w-10',
      },
      fullWidth: {
        true: 'w-full',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export function Button({
  variant,
  size,
  fullWidth,
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      ) : null}
      {children}
    </button>
  );
}

// For next/link and <a> elements, which cannot receive button semantics.
export function buttonClasses(
  options: { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean } = {},
): string {
  return buttonVariants({ variant: options.variant, size: options.size, fullWidth: options.fullWidth });
}