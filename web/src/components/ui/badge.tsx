import { cn } from '@/lib/utils/cn';

export type BadgeTone =
  | 'neutral'
  | 'brand'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'muted';

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: 'bg-ink-100 text-ink-700',
  brand: 'bg-brand-soft text-brand-deep',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  error: 'bg-error/10 text-error',
  info: 'bg-info/10 text-info',
  muted: 'bg-ink-100 text-ink-500',
};

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        TONE_CLASS[tone],
        className,
      )}
      {...props}
    />
  );
}