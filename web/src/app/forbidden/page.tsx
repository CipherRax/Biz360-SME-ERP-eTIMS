import Link from 'next/link';
import { ShieldX } from 'lucide-react';
import { buttonClasses } from '@/components/ui';

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ink-100 px-4 text-center">
      <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-error/10 text-error">
        <ShieldX className="h-7 w-7" aria-hidden />
      </span>
      <h1 className="font-sans text-2xl font-bold text-ink-900">Access denied</h1>
      <p className="mt-2 max-w-sm text-sm text-ink-500">
        Your role does not have permission to view this area. Contact your administrator if you
        believe this is a mistake.
      </p>
      <Link href="/dashboard" className={buttonClasses({ variant: 'primary', size: 'md' }) + ' mt-6'}>
        Back to dashboard
      </Link>
    </div>
  );
}