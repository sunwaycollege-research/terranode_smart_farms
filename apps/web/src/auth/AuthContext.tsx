// TERANODE web — auth context. Owns the session: login posts /auth/login, stores
// tokens in localStorage (via the api client's tokenStore), and exposes the
// current user/account/role. On a hard 401 it clears + signals the router.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Account, PublicUser, UserRole } from '@teranode/types';
import { api, setUnauthorizedHandler, tokenStore, ApiRequestError } from '../api/client';

interface AuthState {
  user: PublicUser | null;
  account: Account | null;
  role: UserRole | null;
  /** True until the initial session restore resolves. */
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    account: null,
    role: null,
    loading: true,
  });
  // bump on forced logout so consumers (router) re-render to the public tree.
  const [, setVersion] = useState(0);
  const mounted = useRef(true);

  const clearSession = useCallback(() => {
    tokenStore.clear();
    setState({ user: null, account: null, role: null, loading: false });
    setVersion((v) => v + 1);
  }, []);

  // Wire the client's 401 handler to drop the session.
  useEffect(() => {
    mounted.current = true;
    setUnauthorizedHandler(() => {
      if (mounted.current) clearSession();
    });
    return () => {
      mounted.current = false;
      setUnauthorizedHandler(null);
    };
  }, [clearSession]);

  // Restore session on boot if a token is present.
  useEffect(() => {
    let active = true;
    (async () => {
      if (!tokenStore.access) {
        if (active) setState((s) => ({ ...s, loading: false }));
        return;
      }
      try {
        const me = await api.getMe();
        if (!active) return;
        setState({
          user: me.user,
          account: me.account,
          role: me.user.role,
          loading: false,
        });
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiRequestError && err.status === 401) {
          tokenStore.clear();
        }
        setState({ user: null, account: null, role: null, loading: false });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login({ email, password });
    // Refresh token is set as an httpOnly cookie by the server; we keep the
    // access token + CSRF token only.
    tokenStore.set(res.accessToken, res.csrfToken);
    setState({
      user: res.user,
      account: res.account,
      role: res.user.role,
      loading: false,
    });
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* best-effort — the cookie is cleared server-side; we clear local state */
    }
    clearSession();
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      isAuthenticated: Boolean(state.user),
      login,
      logout,
    }),
    [state, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
