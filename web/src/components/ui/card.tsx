import { cn } from '@/lib/utils/cn';

export function Card({
  className,
  elevated = true,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { elevated?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-ink-300/60 bg-white',
        elevated && 'shadow-sm',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-6', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('font-sans text-lg font-bold text-ink-900', className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-ink-500', className)} {...props} />;
}

export function CardAction({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('ml-auto shrink-0', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-6 pb-6', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center gap-3 border-t border-ink-100 px-6 py-4', className)}
      {...props}
    />
  );
}