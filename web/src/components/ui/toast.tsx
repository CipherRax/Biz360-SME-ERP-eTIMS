'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastOptions {
  tone?: ToastTone;
  title: string;
  description?: string;
  durationMs?: number;
}

interface ToastItem extends Required<Omit<ToastOptions, 'durationMs'>> {
  id: string;
  durationMs: number;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_ICON = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
} as const;

const TONE_CLASS = {
  success: 'text-success',
  error: 'text-error',
  warning: 'text-warning',
  info: 'text-info',
} as const;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = crypto.randomUUID();
      const item: ToastItem = {
        id,
        tone: options.tone ?? 'info',
        title: options.title,
        description: options.description ?? '',
        durationMs: options.durationMs ?? 5000,
      };
      setItems((prev) => [...prev, item]);
      if (item.durationMs > 0) {
        window.setTimeout(() => dismiss(id), item.durationMs);
      }
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed right-4 top-4 z-50 flex w-full max-w-sm flex-col gap-3"
        aria-live="polite"
        aria-atomic="true"
      >
        {items.map((item) => {
          const Icon = TONE_ICON[item.tone];
          return (
            <div
              key={item.id}
              role="status"
              className="pointer-events-auto flex items-start gap-3 rounded-xl border border-ink-300/60 bg-white p-4 shadow-md"
            >
              <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', TONE_CLASS[item.tone])} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-900">{item.title}</p>
                {item.description ? (
                  <p className="mt-0.5 text-sm text-ink-500">{item.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="rounded-md p-1 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-700"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
}