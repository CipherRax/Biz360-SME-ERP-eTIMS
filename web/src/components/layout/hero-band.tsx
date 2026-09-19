import { cn } from '@/lib/utils/cn';

export function HeroBand({
  eyebrow,
  title,
  description,
  children,
  className,
  backgroundImage,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
  backgroundImage?: string;
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-deep via-brand to-brand-hover px-6 py-8 text-white sm:px-10 sm:py-12',
        className,
      )}
    >
      <div
        className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-white/10"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-32 right-24 h-64 w-64 rounded-full bg-white/5"
        aria-hidden
      />
      {backgroundImage ? (
        <div
          className="absolute inset-0 bg-cover bg-center opacity-20"
          style={{ backgroundImage: `url(${backgroundImage})` }}
          aria-hidden
        />
      ) : null}
      <div className="relative max-w-2xl">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/80">{eyebrow}</p>
        ) : null}
        <h1 className="mt-2 font-sans text-3xl font-bold leading-tight sm:text-4xl">{title}</h1>
        {description ? <p className="mt-3 text-sm text-white/85 sm:text-base">{description}</p> : null}
      </div>
      {children ? <div className="relative mt-6">{children}</div> : null}
    </div>
  );
}