'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/lib/auth/auth-context';
import { ToastProvider } from '@/components/ui/toast';
import { ApiError } from '@/lib/api/http';

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Never retry auth/permission/validation failures — only transient 5xx.
          if (error instanceof ApiError) return error.status >= 500 && failureCount < 1;
          return failureCount < 2;
        },
      },
      mutations: { retry: 0 },
    },
  });
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [client] = useState(createQueryClient);

  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AuthProvider>{children}</AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}