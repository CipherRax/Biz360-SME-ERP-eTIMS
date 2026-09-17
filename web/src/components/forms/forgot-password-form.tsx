'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MailCheck } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui';
import { forgotPassword } from '@/lib/auth/public-auth';
import { ApiError } from '@/lib/api/http';

const schema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
});

type FormValues = z.infer<typeof schema>;

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '' } });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await forgotPassword(values.email.trim().toLowerCase());
      setSent(true);
    } catch (error) {
      // Endpoint is enumeration-safe and normally 200s; only surface transport errors.
      if (error instanceof ApiError && error.status >= 500) {
        setFormError('Something went wrong. Please try again shortly.');
      } else {
        setSent(true);
      }
    }
  });

  if (sent) {
    return (
      <div className="text-center">
        <span className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand-deep">
          <MailCheck className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="font-sans text-2xl font-bold text-ink-900">Check your inbox</h1>
        <p className="mt-2 text-sm text-ink-500">
          If an account exists for {getValues('email')}, a reset link is on its way.
        </p>
        <Link href="/login" className="mt-6 inline-block text-sm font-semibold text-brand hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div>
      <p className="eyebrow">Account recovery</p>
      <h1 className="mt-1 font-sans text-2xl font-bold text-ink-900">Reset your password</h1>
      <p className="mt-1 text-sm text-ink-500">
        Enter your email and we&apos;ll send you a secure link to choose a new password.
      </p>

      {formError ? (
        <div role="alert" className="mt-6 rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
          {formError}
        </div>
      ) : null}

      <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Field label="Email address" htmlFor="email" error={errors.email?.message} required>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            placeholder="you@company.co.ke"
            invalid={Boolean(errors.email)}
            {...register('email')}
          />
        </Field>
        <Button type="submit" size="lg" loading={isSubmitting} className="mt-1">
          Send reset link
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-500">
        Remembered it?{' '}
        <Link href="/login" className="font-semibold text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}