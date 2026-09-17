'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageLoader } from '@/components/ui';
import { useAuth } from '@/lib/auth/auth-context';
import { DashboardShell } from './dashboard-shell';

// Middleware already blocks unauthenticated access at the edge; this guards
// against the brief window before the in-memory token is rehydrated and makes
// client-side navigations after a session drop bounce cleanly.
export function DashboardGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { status } = useAuth();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  if (status !== 'authenticated') {
    return <PageLoader label="Loading your workspace…" />;
  }

  return <DashboardShell>{children}</DashboardShell>;
}