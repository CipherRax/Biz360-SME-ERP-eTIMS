'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, XCircle } from 'lucide-react';
import { PageLoader } from '@/components/ui';
import { verifyEmail } from '@/lib/auth/public-auth';
import { ApiError } from '@/lib/api/http';

type State = 'verifying' | 'success' | 'error';

export function VerifyEmailPanel({ token }: { token: string }) {
  const [state, setState] = useState<State>(token ? 'verifying' : 'error');
  const [message, setMessage] = useState<string>(
    token ? '' : 'This verification link is missing or incomplete.',
  );
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    void verifyEmail(token)
      .then(() => {
        setState('success');
      })
      .catch((error: unknown) => {
        setState('error');
        setMessage(
          error instanceof ApiError && error.status === 400
            ? 'This verification link is invalid or has expired.'
            : 'We could not verify your email. Please try again.',
        );
      });
  }, [token]);

  if (state === 'verifying') {
    return <PageLoader label="Verifying your email…" />;
  }

  if (state === 'success') {
    return (
      <div className="text-center">
        <span className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand-deep">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="font-sans text-2xl font-bold text-ink-900">Email verified</h1>
        <p className="mt-2 text-sm text-ink-500">Your account is ready. You can sign in now.</p>
        <Link href="/login" className="mt-6 inline-block text-sm font-semibold text-brand hover:underline">
          Continue to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="text-center">
      <span className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-error/10 text-error">
        <XCircle className="h-6 w-6" aria-hidden />
      </span>
      <h1 className="font-sans text-2xl font-bold text-ink-900">Verification failed</h1>
      <p className="mt-2 text-sm text-ink-500">{message}</p>
      <Link href="/login" className="mt-6 inline-block text-sm font-semibold text-brand hover:underline">
        Back to sign in
      </Link>
    </div>
  );
}