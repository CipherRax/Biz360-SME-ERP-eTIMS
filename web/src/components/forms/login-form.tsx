'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { Button, Field, Input, useToast } from '@/components/ui';
import { useAuth } from '@/lib/auth/auth-context';
import { ApiError } from '@/lib/api/http';

const schema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type FormValues = z.infer<typeof schema>;

export function LoginForm({ nextPath, reason }: { nextPath?: string; reason?: string }) {
  const router = useRouter();
  const { login } = useAuth();
  const { toast } = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });

  const notice =
    reason === 'idle'
      ? 'You were signed out after a period of inactivity.'
      : reason === 'expired'
        ? 'Your session expired. Please sign in again.'
        : null;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values.email.trim().toLowerCase(), values.password);
      toast({ tone: 'success', title: 'Signed in', description: 'Welcome back to Biz360.' });
      router.push(nextPath && nextPath.startsWith('/') ? nextPath : '/dashboard');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 423) {
          setFormError('Account locked after too many attempts. Try again later or contact your admin.');
        } else if (error.status === 403) {
          setFormError(error.message);
        } else if (error.status === 401) {
          setFormError('Email or password is incorrect.');
        } else {
          setFormError(error.message);
        }
      } else if (error instanceof Error) {
        setFormError(error.message);
      } else {
        setFormError('Unable to sign in right now.');
      }
    }
  });

  return (
    <div>
      <p className="eyebrow">Welcome back</p>
      <h1 className="mt-1 font-sans text-2xl font-bold text-ink-900">Sign in to Biz360</h1>
      <p className="mt-1 text-sm text-ink-500">
        Use the email and password issued by your organization administrator.
      </p>

      {notice ? (
        <div className="mt-6 rounded-lg border border-info/30 bg-info/5 px-4 py-3 text-sm text-info">
          {notice}
        </div>
      ) : null}

      {formError ? (
        <div
          role="alert"
          className="mt-6 rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-sm text-error"
        >
          {formError}
        </div>
      ) : null}

      <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Field label="Email address" htmlFor="email" error={errors.email?.message} required>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
            <Input
              id="email"
              type="email"
              autoComplete="username"
              className="pl-10"
              placeholder="you@company.co.ke"
              invalid={Boolean(errors.email)}
              {...register('email')}
            />
          </div>
        </Field>

        <Field label="Password" htmlFor="password" error={errors.password?.message} required>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              className="pl-10 pr-10"
              placeholder="••••••••"
              invalid={Boolean(errors.password)}
              {...register('password')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ink-500 hover:bg-ink-100"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>

        <div className="flex items-center justify-between">
          <Link href="/forgot-password" className="text-sm font-medium text-brand hover:underline">
            Forgot password?
          </Link>
        </div>

        <Button type="submit" size="lg" loading={isSubmitting} className="mt-1">
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-500">
        New to Biz360?{' '}
        <Link href="/register" className="font-semibold text-brand hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}