import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { api } from '../api/client';
import type { Account, PublicUser, UserRole } from '@teranode/types';

/** Convenience alias for the two roles the mobile app cares about. */
export type Role = UserRole; // 'admin' | 'customer'

export interface Session {
  token: string;
  user: PublicUser;
  account: Account;
}

interface AuthState {
  session: Session | null;
  loading: boolean;
  /** Password is required by the real API; the mock ignores it. */
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  role: Role | null;
}

const AuthContext = createContext<AuthState | undefined>(undefined);
const KEY = 'teranode.session';

// SecureStore is unavailable on web; fall back to memory there.
async function save(v: string) {
  if (Platform.OS === 'web') return;
  await SecureStore.setItemAsync(KEY, v);
}
async function load() {
  if (Platform.OS === 'web') return null;
  return SecureStore.getItemAsync(KEY);
}
async function clear() {
  if (Platform.OS === 'web') return;
  await SecureStore.deleteItemAsync(KEY);
}

/**
 * Normalise whatever the api/mock returns into the 2-role Session shape.
 * The mock still ships legacy multi-tier accounts/users; we collapse them to
 * the admin|customer model here so the rest of the app only ever sees 2 roles.
 */
function normalizeSession(res: {
  token?: string;
  accessToken?: string;
  user: { id: string; accountId: string; email: string; name: string; role: string; locale?: string | null; createdAt?: string };
  account: { id: string; type: string; name: string; parentId: string | null; status?: string; plan?: string | null; locale?: string; createdAt?: string; updatedAt?: string };
}): Session {
  const role: UserRole = res.user.role === 'admin' || res.account.type === 'admin' ? 'admin' : 'customer';
  const accountType = role === 'admin' ? 'admin' : 'customer';
  const now = new Date().toISOString();

  const user: PublicUser = {
    id: res.user.id,
    accountId: res.user.accountId,
    email: res.user.email,
    name: res.user.name,
    role,
    locale: res.user.locale ?? null,
    createdAt: res.user.createdAt ?? now,
  };
  const account: Account = {
    id: res.account.id,
    type: accountType,
    name: res.account.name,
    parentId: res.account.parentId ?? null,
    status: (res.account.status as Account['status']) ?? 'active',
    plan: res.account.plan ?? null,
    locale: res.account.locale ?? 'en',
    createdAt: res.account.createdAt ?? now,
    updatedAt: res.account.updatedAt ?? now,
  };
  return { token: res.token ?? res.accessToken ?? '', user, account };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const raw = await load();
        if (raw) setSession(JSON.parse(raw));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    // api.login is owned by unit 5.M5 and will take (email, password); call it
    // loosely so this unit typechecks against the current 1-arg mock signature.
    const res = await (api.login as (e: string, p?: string) => Promise<unknown>)(email, password);
    const s = normalizeSession(res as Parameters<typeof normalizeSession>[0]);
    setSession(s);
    await save(JSON.stringify(s));
  }, []);

  const signOut = useCallback(async () => {
    setSession(null);
    await clear();
  }, []);

  const value = useMemo<AuthState>(
    () => ({ session, loading, signIn, signOut, role: session?.user.role ?? null }),
    [session, loading, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Which route group a role lands in (2-role model). */
export function homeGroupForRole(role: Role | null): '(customer)' | '(auth)' {
  return role === 'customer' ? '(customer)' : '(auth)';
}
