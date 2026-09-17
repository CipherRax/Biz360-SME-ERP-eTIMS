import { cn } from '@/lib/utils/cn';

export function TableWrapper({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('overflow-x-auto rounded-xl border border-ink-300/60 bg-white', className)} {...props} />
  );
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full min-w-[640px] border-collapse text-sm', className)} {...props} />;
}

export function TableHead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-ink-100/70', className)} {...props} />;
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-ink-100', className)} {...props} />;
}

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('transition-colors hover:bg-brand-tint/60', className)} {...props} />;
}

export function TableHeaderCell({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-500',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-3 align-middle text-ink-700', className)} {...props} />;
}

export function TableEmpty({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-ink-500">
        {children}
      </td>
    </tr>
  );
}