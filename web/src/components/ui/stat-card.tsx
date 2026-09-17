import { cn } from '@/lib/utils/cn';
import type { LucideIcon } from 'lucide-react';
import { IconBadge } from './icon-badge';

type Tone = 'brand' | 'info' | 'success' | 'warning' | 'error' | 'neutral';

export function StatCard({
  label,
  value,
  icon,
  tone = 'brand',
  hint,
  trend,
  className,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: Tone;
  hint?: string;
  trend?: { value: string; positive?: boolean };
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-ink-300/60 bg-white p-5 shadow-sm', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
          <p className="mt-2 font-sans text-2xl font-bold text-ink-900">{value}</p>
          {hint ? <p className="mt-1 text-xs text-ink-500">{hint}</p> : null}
        </div>
        <IconBadge icon={icon} tone={tone} />
      </div>
      {trend ? (
        <p
          className={cn(
            'mt-3 text-xs font-semibold',
            trend.positive === false ? 'text-error' : 'text-success',
          )}
        >
          {trend.value}
        </p>
      ) : null}
    </div>
  );
}