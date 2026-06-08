import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { api, setTokens, setOnTokensPersist, setUnauthorizedHandler } from '../api/client';
import type { Account, PublicUser, UserRole } from '@teranode/types';

/** Convenience alias for the two roles the mobile app cares about. */
export type Role = UserRole; // 'admin' | 'customer'

export interface Session {
  token: string;
  refreshToken: string | null;
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
 * Drop all per-account DATA caches (e.g. the dashboard overview) on sign-out so a
 * different account can never see the previous account's cached field data. UI
 * PREFERENCES (language, field mode) are intentionally kept.
 */
async function clearDataCaches() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const dataKeys = keys.filter(
      (k) => k.startsWith('teranode.overview') || k.startsWith('teranode.cache'),
    );
    if (dataKeys.length) await AsyncStorage.multiRemove(dataKeys);
  } catch {
    /* ignore — cache clearing is best-effort */
  }
}

/**
 * Normalise whatever the api/mock returns into the 2-role Session shape.
 * The mock still ships legacy multi-tier accounts/users; we collapse them to
 * the admin|customer model here so the rest of the app only ever sees 2 roles.
 */
function normalizeSession(res: {
  token?: string;
  accessToken?: string;
  refreshToken?: string | null;
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
  return {
    token: res.token ?? res.accessToken ?? '',
    refreshToken: res.refreshToken ?? null,
    user,
    account,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const raw = await load();
        if (raw) {
          const s = JSON.parse(raw) as Session;
          // A session saved while the app was in MOCK mode has a fake `mock.*`
          // token the real API rejects (→ "could not load" + a mock profile).
          // Drop it so the user logs in fresh against the live backend.
          if (!s.token || s.token.startsWith('mock.')) {
            await clear();
            await clearDataCaches();
          } else {
            // Re-attach the tokens to the api client so requests are authed after a
            // cold start (the in-memory token store is empty on boot).
            setTokens(s.token, s.refreshToken ?? null);
            setSession(s);
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Persist silently-refreshed tokens back to SecureStore + session state.
  useEffect(() => {
    setOnTokensPersist((access, refresh) => {
      setSession((prev) => {
        if (!prev) return prev;
        const next = { ...prev, token: access, refreshToken: refresh };
        void save(JSON.stringify(next));
        return next;
      });
    });
    return () => setOnTokensPersist(null);
  }, []);

  // An unrecoverable 401 (dead/stale session) → clear it so the app routes back
  // to login instead of getting stuck on an error screen with a bad token.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setTokens(null, null);
      setSession(null);
      void clear();
      void clearDataCaches();
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    const s = normalizeSession(res);
    setTokens(s.token, s.refreshToken);
    setSession(s);
    await save(JSON.stringify(s));
  }, []);

  const signOut = useCallback(async () => {
    await api.logout(); // revoke the refresh token server-side (best-effort)
    setTokens(null, null);
    setSession(null);
    await clear();
    await clearDataCaches(); // never leak one account's field data to the next
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
