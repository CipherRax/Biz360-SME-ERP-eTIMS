import type { Metadata } from 'next';
import { LoginForm } from '@/components/forms/login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const params = await searchParams;
  return <LoginForm nextPath={params.next} reason={params.reason} />;
}