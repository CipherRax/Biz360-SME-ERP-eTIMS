import { cn } from '@/lib/utils/cn';
import type { LucideIcon } from 'lucide-react';

type IconBadgeTone = 'brand' | 'info' | 'success' | 'warning' | 'error' | 'neutral';

const TONE_CLASS: Record<IconBadgeTone, string> = {
  brand: 'bg-brand-soft text-brand-deep',
  info: 'bg-info/10 text-info',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  error: 'bg-error/10 text-error',
  neutral: 'bg-ink-100 text-ink-700',
};

const SIZE_CLASS = {
  sm: 'h-8 w-8 rounded-lg',
  md: 'h-10 w-10 rounded-xl',
  lg: 'h-12 w-12 rounded-xl',
} as const;

export function IconBadge({
  icon: Icon,
  tone = 'brand',
  size = 'md',
  className,
}: {
  icon: LucideIcon;
  tone?: IconBadgeTone;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
}) {
  return (
    <span
      className={cn('inline-flex items-center justify-center', SIZE_CLASS[size], TONE_CLASS[tone], className)}
    >
      <Icon className={size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'} aria-hidden />
    </span>
  );
}