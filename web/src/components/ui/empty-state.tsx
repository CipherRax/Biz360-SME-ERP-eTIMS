import { cn } from '@/lib/utils/cn';
import type { LucideIcon } from 'lucide-react';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-300 bg-white px-6 py-14 text-center',
        className,
      )}
    >
      {Icon ? (
        <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand-deep">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
      ) : null}
      <h3 className="font-sans text-base font-bold text-ink-900">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-sm text-ink-500">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}