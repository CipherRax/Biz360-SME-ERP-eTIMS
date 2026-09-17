import { forwardRef } from 'react';
import { cn } from '@/lib/utils/cn';

const FIELD_BASE =
  'w-full rounded-lg border bg-white px-3.5 text-sm text-ink-900 placeholder:text-ink-500/70 transition-colors focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:cursor-not-allowed disabled:bg-ink-100';

export const fieldClasses = (invalid?: boolean) =>
  cn(FIELD_BASE, invalid ? 'border-error focus:border-error' : 'border-ink-300 focus:border-brand');

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => (
    <input ref={ref} className={cn(fieldClasses(invalid), 'h-11', className)} aria-invalid={invalid} {...props} />
  ),
);
Input.displayName = 'Input';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(fieldClasses(invalid), 'min-h-24 py-2.5', className)}
      aria-invalid={invalid}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, invalid, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(fieldClasses(invalid), 'h-11 appearance-none pr-9', className)}
      aria-invalid={invalid}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn('text-sm font-medium text-ink-700', className)} {...props} />
  );
}

export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p className="text-xs font-medium text-error" role="alert">
      {children}
    </p>
  );
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="ml-0.5 text-error">*</span> : null}
      </Label>
      {children}
      {hint && !error ? <p className="text-xs text-ink-500">{hint}</p> : null}
      <FieldError>{error}</FieldError>
    </div>
  );
}