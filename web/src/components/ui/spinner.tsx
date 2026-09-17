import { cn } from '@/lib/utils/cn';

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        'inline-block h-5 w-5 animate-spin rounded-full border-2 border-brand/30 border-t-brand',
        className,
      )}
    />
  );
}

export function PageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center gap-3 text-sm text-ink-500">
      <Spinner />
      {label}
    </div>
  );
}