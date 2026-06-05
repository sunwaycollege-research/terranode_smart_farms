import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import { Button, Card, LanguageSwitcher, TextField } from '../../components';

interface LocationState {
  from?: { pathname: string };
}

export default function LoginPage() {
  const { t } = useTranslation();
  const { login, isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as LocationState | null)?.from?.pathname ?? '/customers';

  // Prefill demo credentials only in dev builds — never in production.
  const isDev = import.meta.env.DEV;
  const [email, setEmail] = useState(isDev ? 'admin@teranode.io' : '');
  const [password, setPassword] = useState(isDev ? 'teranode' : '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch {
      setError(t('login.failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="tn-login">
      <div className="tn-login__card">
        <div className="tn-login__brand">
          <div className="tn-sidebar__logo">🌱</div>
          <div className="tn-login__title display">{t('app.name')}</div>
        </div>

        <Card title={t('login.title')} actions={<LanguageSwitcher />}>
          <p className="tn-muted" style={{ marginTop: 0, marginBottom: 'var(--sp-lg)' }}>
            {t('login.subtitle')}
          </p>
          <form className="tn-stack" onSubmit={onSubmit}>
            <TextField
              label={t('login.email')}
              type="email"
              autoComplete="username"
              value={email}
              onChange={setEmail}
              required
              autoFocus
            />
            <TextField
              label={t('login.password')}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
              required
              error={error ?? undefined}
            />
            <Button type="submit" block loading={submitting}>
              {submitting ? t('login.signingIn') : t('login.submit')}
            </Button>
          </form>
          {isDev && (
            <p className="tn-login__hint">
              {t('login.demoHint', { email: 'admin@teranode.io', password: 'teranode' })}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
