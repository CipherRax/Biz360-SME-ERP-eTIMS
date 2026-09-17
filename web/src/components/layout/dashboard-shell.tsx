'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { useAuth } from '@/lib/auth/auth-context';
import { TopNav } from './top-nav';
import { Footer } from './footer';
import { NAV_ITEMS, isNavItemActive } from './nav';

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const visible = NAV_ITEMS.filter((item) => (user ? item.roles.includes(user.role) : false));

  return (
    <div className="flex min-h-screen flex-col bg-ink-100">
      <TopNav onOpenMenu={() => setDrawerOpen(true)} />

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-ink-900/40"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-white shadow-xl">
            <div className="flex h-16 items-center justify-between border-b border-ink-100 px-4">
              <span className="font-sans text-lg font-bold text-ink-900">
                Biz<span className="text-brand">360</span>
              </span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-lg p-2 text-ink-700 hover:bg-ink-100"
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3" aria-label="Mobile">
              {visible.map((item) => {
                const active = isNavItemActive(item, pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                      active
                        ? 'bg-brand-soft text-brand-deep'
                        : 'text-ink-700 hover:bg-ink-100',
                    )}
                  >
                    <item.icon className="h-4 w-4" aria-hidden />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      ) : null}

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
      <Footer />
    </div>
  );
}