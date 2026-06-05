import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { Button } from '../components';

/**
 * Gate for the protected admin tree.
 *  - unauthenticated → redirect to /login
 *  - authenticated but NOT an admin → block (the web console is administrators-only;
 *    customers/farmers use the mobile app). This keeps the admin nav + pages from
 *    ever rendering for a non-admin (the API also enforces this with requireAdmin).
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading, role, user, logout } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="tn-center">Loading…</div>;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (role !== 'admin') {
    return (
      <div className="tn-center" style={{ minHeight: '100vh', padding: 'var(--sp-xl)' }}>
        <div style={{ maxWidth: 440, textAlign: 'center', display: 'grid', gap: 'var(--sp-md)' }}>
          <h2 style={{ margin: 0 }}>Administrators only</h2>
          <p className="tn-muted" style={{ margin: 0 }}>
            This console is for TERANODE administrators.
            {user?.email ? ` You're signed in as ${user.email} (${role}).` : ''} Farmers
            manage their fields from the TERANODE mobile app.
          </p>
          <div className="tn-row" style={{ justifyContent: 'center' }}>
            <Button onClick={() => void logout()}>Sign out</Button>
          </div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
