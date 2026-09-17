'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { KeyRound } from 'lucide-react';
import { Button, Field, Input, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/http';

const schema = z
  .object({
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(72, 'Password must be at most 72 characters')
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).*$/,
        'Include at least one uppercase, one lowercase and one number',
      ),
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof schema>;

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  if (!token) {
    return (
      <div className="text-center">
        <h1 className="font-sans text-2xl font-bold text-ink-900">Invalid reset link</h1>
        <p className="mt-2 text-sm text-ink-500">
          This password reset link is missing or incomplete. Request a new one to continue.
        </p>
        <Link href="/forgot-password" className="mt-6 inline-block text-sm font-semibold text-brand hover:underline">
          Request a new link
        </Link>
      </div>
    );
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.post('/auth/password/reset', { token, newPassword: values.newPassword }, { skipAuth: true });
      toast({ tone: 'success', title: 'Password updated', description: 'Sign in with your new password.' });
      router.push('/login');
    } catch (error) {
      setFormError(
        error instanceof ApiError
          ? error.status === 400
            ? 'This reset link is invalid or has expired.'
            : error.message
          : 'Unable to reset your password.',
      );
    }
  });

  return (
    <div>
      <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand-deep">
        <KeyRound className="h-6 w-6" aria-hidden />
      </span>
      <h1 className="font-sans text-2xl font-bold text-ink-900">Choose a new password</h1>
      <p className="mt-1 text-sm text-ink-500">Make it strong and unique to this account.</p>

      {formError ? (
        <div role="alert" className="mt-6 rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
          {formError}
        </div>
      ) : null}

      <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Field
          label="New password"
          htmlFor="newPassword"
          error={errors.newPassword?.message}
          hint="8–72 characters with uppercase, lowercase and a number."
          required
        >
          <Input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            invalid={Boolean(errors.newPassword)}
            {...register('newPassword')}
          />
        </Field>
        <Field label="Confirm password" htmlFor="confirmPassword" error={errors.confirmPassword?.message} required>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            invalid={Boolean(errors.confirmPassword)}
            {...register('confirmPassword')}
          />
        </Field>
        <Button type="submit" size="lg" loading={isSubmitting} className="mt-1">
          Update password
        </Button>
      </form>
    </div>
  );
}