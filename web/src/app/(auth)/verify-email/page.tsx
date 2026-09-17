import type { Metadata } from 'next';
import { VerifyEmailPanel } from '@/components/forms/verify-email-panel';

export const metadata: Metadata = { title: 'Verify email' };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  return <VerifyEmailPanel token={params.token ?? ''} />;
}