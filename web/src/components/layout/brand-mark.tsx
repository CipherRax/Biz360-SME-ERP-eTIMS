import Link from 'next/link';
import { cn } from '@/lib/utils/cn';
import logo from '@/images/logo.png';

export function BrandMark({
  href = '/dashboard',
  className,
  symbolClassName,
}: {
  href?: string;
  className?: string;
  symbolClassName?: string;
}) {
  return (
    <Link href={href} className={cn('flex items-center gap-2.5', className)}>
      <span
        className={cn(
          'inline-flex h-9 w-9 shrink-0 rounded-lg bg-brand bg-cover bg-center',
          symbolClassName,
        )}
        style={{ backgroundImage: `url(${logo.src})` }}
        aria-hidden
      />
      <span className="font-sans text-lg font-bold text-ink-900">
        Biz<span className="text-brand">360</span>
      </span>
    </Link>
  );
}
