'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { Button, Field, Input, useToast } from '@/components/ui';
import { useAuth } from '@/lib/auth/auth-context';
import { ApiError } from '@/lib/api/http';

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(120),
  organizationName: z.string().max(160).optional().or(z.literal('')),
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be at most 72 characters')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).*$/,
      'Include at least one uppercase, one lowercase and one number',
    ),
});

type FormValues = z.infer<typeof schema>;

export function RegisterForm() {
  const router = useRouter();
  const { register: createAccount } = useAuth();
  const { toast } = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState<{ devToken?: string; email: string } | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', organizationName: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const result = await createAccount({
        name: values.name.trim(),
        email: values.email.trim().toLowerCase(),
        password: values.password,
        organizationName: values.organizationName?.trim() || undefined,
      });
      if (result.requiresEmailVerification) {
        setPending({ devToken: result.devVerificationToken, email: values.email });
        return;
      }
      toast({ tone: 'success', title: 'Account created', description: 'Welcome to Biz360.' });
      router.push('/dashboard');
      router.refresh();
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Unable to create your account.');
    }
  });

  if (pending) {
    return (
      <div className="text-center">
        <span className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand-deep">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="font-sans text-2xl font-bold text-ink-900">Check your inbox</h1>
        <p className="mt-2 text-sm text-ink-500">
          We sent a verification link to <span className="font-medium text-ink-700">{pending.email}</span>.
          Verify your email to sign in.
        </p>
        {pending.devToken ? (
          <div className="mt-6 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-left text-sm">
            <p className="font-semibold text-warning">Development mode</p>
            <p className="mt-1 text-ink-600">Email delivery is disabled locally. Verify directly:</p>
            <Link
              href={`/verify-email?token=${encodeURIComponent(pending.devToken)}`}
              className="mt-2 inline-block font-medium text-brand hover:underline"
            >
              Verify email now
            </Link>
          </div>
        ) : null}
        <Link href="/login" className="mt-6 inline-block text-sm font-semibold text-brand hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div>
      <p className="eyebrow">Get started</p>
      <h1 className="mt-1 font-sans text-2xl font-bold text-ink-900">Create your account</h1>
      <p className="mt-1 text-sm text-ink-500">
        Set up your organization and start invoicing in minutes.
      </p>

      {formError ? (
        <div
          role="alert"
          className="mt-6 rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-sm text-error"
        >
          {formError}
        </div>
      ) : null}

      <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Field label="Full name" htmlFor="name" error={errors.name?.message} required>
          <Input id="name" autoComplete="name" placeholder="Jane Wanjiku" invalid={Boolean(errors.name)} {...register('name')} />
        </Field>

        <Field
          label="Organization name"
          htmlFor="organizationName"
          error={errors.organizationName?.message}
          hint="Leave blank to use your name."
        >
          <Input
            id="organizationName"
            autoComplete="organization"
            placeholder="Acme Traders Ltd"
            invalid={Boolean(errors.organizationName)}
            {...register('organizationName')}
          />
        </Field>

        <Field label="Work email" htmlFor="email" error={errors.email?.message} required>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            placeholder="you@company.co.ke"
            invalid={Boolean(errors.email)}
            {...register('email')}
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          error={errors.password?.message}
          hint="8–72 characters with uppercase, lowercase and a number."
          required
        >
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              className="pr-10"
              placeholder="Create a strong password"
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

        <Button type="submit" size="lg" loading={isSubmitting} className="mt-1">
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-500">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}