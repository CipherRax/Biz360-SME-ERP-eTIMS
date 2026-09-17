'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { tokenStore } from './access-token';
import { endSession, refreshSession, type SessionUser } from './session';
import { ApiError } from '@/lib/api/http';
import type { Role } from '@/types/domain';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  login: (email: string, password: string) => Promise<SessionUser>;
  register: (input: {
    name: string;
    email: string;
    password: string;
    organizationName?: string;
  }) => Promise<{ requiresEmailVerification: boolean; devVerificationToken?: string }>;
  logout: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
  refresh: () => Promise<SessionUser | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Financial console: sign out after this much inactivity.
const IDLE_TIMEOUT_MS = 20 * 60 * 1000;
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'visibilitychange'];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const idleTimer = useRef<number | null>(null);

  const clearIdleTimer = useCallback(() => {
    if (idleTimer.current !== null) {
      window.clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
  }, []);

  const signOutLocal = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setStatus('anonymous');
    clearIdleTimer();
  }, [clearIdleTimer]);

  const logout = useCallback(async () => {
    await endSession();
    signOutLocal();
    router.push('/login');
    router.refresh();
  }, [router, signOutLocal]);

  const scheduleIdleLogout = useCallback(() => {
    clearIdleTimer();
    idleTimer.current = window.setTimeout(() => {
      void endSession().finally(() => {
        signOutLocal();
        router.push('/login?reason=idle');
      });
    }, IDLE_TIMEOUT_MS);
  }, [clearIdleTimer, router, signOutLocal]);

  // Bootstrap: silently exchange the httpOnly refresh cookie for an in-memory
  // access token. On a full reload this is how the session comes back.
  useEffect(() => {
    let cancelled = false;
    void refreshSession().then((sessionUser) => {
      if (cancelled) return;
      if (sessionUser) {
        setUser(sessionUser);
        setStatus('authenticated');
        scheduleIdleLogout();
      } else {
        setStatus('anonymous');
      }
    });
    return () => {
      cancelled = true;
      clearIdleTimer();
    };
  }, [scheduleIdleLogout, clearIdleTimer]);

  // Any final 401 from the API client ends the local session.
  useEffect(() => {
    const onUnauthorized = () => {
      signOutLocal();
      router.push('/login?reason=expired');
    };
    window.addEventListener('auth:unauthorized', onUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', onUnauthorized);
  }, [router, signOutLocal]);

  // Idle tracking.
  useEffect(() => {
    if (status !== 'authenticated') return;
    const onActivity = () => scheduleIdleLogout();
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, onActivity, { passive: true }));
    return () => {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, onActivity));
    };
  }, [status, scheduleIdleLogout]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    const envelope = (await res.json()) as {
      success: boolean;
      message: string;
      errors?: Array<{ message: string; path?: string }>;
      data: { accessToken: string; expiresIn: number; user: SessionUser } | null;
    };
    if (!res.ok || !envelope.success || !envelope.data) {
      throw new ApiError(res.status, envelope.message || 'Unable to sign in', envelope.errors ?? []);
    }
    tokenStore.set(envelope.data.accessToken, envelope.data.expiresIn);
    setUser(envelope.data.user);
    setStatus('authenticated');
    scheduleIdleLogout();
    return envelope.data.user;
  }, [scheduleIdleLogout]);

  const register = useCallback<AuthContextValue['register']>(async (input) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(input),
    });
    const envelope = (await res.json()) as {
      success: boolean;
      message: string;
      errors?: Array<{ message: string; path?: string }>;
      data: {
        requiresEmailVerification: boolean;
        devVerificationToken?: string;
        tokens?: { accessToken: string; expiresIn: number } | null;
      } | null;
    };
    if (!res.ok || !envelope.success || !envelope.data) {
      throw new ApiError(res.status, envelope.message || 'Unable to create account', envelope.errors ?? []);
    }
    if (envelope.data.tokens) {
      tokenStore.set(envelope.data.tokens.accessToken, envelope.data.tokens.expiresIn);
      const sessionUser = await refreshSession();
      if (sessionUser) {
        setUser(sessionUser);
        setStatus('authenticated');
        scheduleIdleLogout();
      }
    }
    return {
      requiresEmailVerification: envelope.data.requiresEmailVerification,
      devVerificationToken: envelope.data.devVerificationToken,
    };
  }, [scheduleIdleLogout]);

  const refresh = useCallback(async () => {
    const sessionUser = await refreshSession();
    if (sessionUser) {
      setUser(sessionUser);
      setStatus('authenticated');
    } else {
      signOutLocal();
    }
    return sessionUser;
  }, [signOutLocal]);

  const hasRole = useCallback(
    (...roles: Role[]) => (user ? roles.includes(user.role) : false),
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, register, logout, hasRole, refresh }),
    [status, user, login, register, logout, hasRole, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}