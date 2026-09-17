'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, ChevronDown, LogOut, Menu, ShieldCheck } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils/cn';
import { ROLE_LABEL } from '@/lib/utils/status';
import { initials } from '@/lib/utils/format';
import { useAuth } from '@/lib/auth/auth-context';
import { notificationsApi } from '@/lib/api';
import { NAV_ITEMS } from './nav';

export function TopNav({ onOpenMenu }: { onOpenMenu?: () => void }) {
  const pathname = usePathname();
  const { user, logout, hasRole } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const unread = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => notificationsApi.unreadCount(),
    enabled: Boolean(user),
    refetchInterval: 60_000,
  });

  const visible = NAV_ITEMS.filter((item) => (user ? item.roles.includes(user.role) : false));
  const unreadCount = unread.data?.count ?? 0;

  return (
    <header className="sticky top-0 z-40 h-16 border-b border-ink-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-full max-w-[1400px] items-center gap-4 px-4 sm:px-6">
        <button
          type="button"
          onClick={onOpenMenu}
          className="rounded-lg p-2 text-ink-700 hover:bg-ink-100 lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>

        <Link href="/dashboard" className="flex items-center gap-2.5">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-white">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          <span className="font-sans text-lg font-bold text-ink-900">
            Biz<span className="text-brand">360</span>
          </span>
        </Link>

        <nav className="ml-4 hidden items-center gap-1 lg:flex" aria-label="Primary">
          {visible.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'relative px-3 py-2 text-sm font-medium transition-colors',
                  active ? 'text-brand-deep' : 'text-ink-700 hover:text-brand-deep',
                )}
              >
                {item.label}
                {active ? (
                  <span className="absolute inset-x-2 -bottom-[21px] h-0.5 rounded-full bg-brand" />
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/notifications"
            className="relative rounded-lg p-2 text-ink-700 hover:bg-ink-100"
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 ? (
              <span className="absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            ) : null}
          </Link>

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="flex items-center gap-2 rounded-lg py-1.5 pl-1.5 pr-2 hover:bg-ink-100"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-deep">
                {user ? initials(user.email.split('@')[0]) : '—'}
              </span>
              <span className="hidden text-left sm:block">
                <span className="block max-w-[140px] truncate text-sm font-semibold text-ink-900">
                  {user?.email}
                </span>
                <span className="block text-xs text-ink-500">
                  {user ? ROLE_LABEL[user.role] : ''}
                </span>
              </span>
              <ChevronDown className="h-4 w-4 text-ink-500" />
            </button>

            {menuOpen ? (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setMenuOpen(false)}
                  aria-hidden
                />
                <div
                  role="menu"
                  className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-ink-300/60 bg-white py-1 shadow-lg"
                >
                  <Link
                    href="/settings/profile"
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                    className="block px-4 py-2 text-sm text-ink-700 hover:bg-ink-100"
                  >
                    Profile
                  </Link>
                  {hasRole('ADMIN') ? (
                    <Link
                      href="/settings"
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-ink-700 hover:bg-ink-100"
                    >
                      Organization settings
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      void logout();
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-medium text-error hover:bg-error/5"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}