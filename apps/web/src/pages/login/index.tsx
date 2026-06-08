import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import { Button, Card, LanguageSwitcher, TextField } from '../../components';
import './login.css';

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

  // Reuse the existing `demoHint` string for its (translated) leading label,
  // then render the credentials ourselves as <code> for scannability.
  // e.g. "Demo: {{email}} / {{password}}" -> "Demo".
  const demoLabel = t('login.demoHint')
    .split('{{email}}')[0]
    .replace(/[\s:/]+$/, '')
    .trim();

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
      <div className="tn-login__card lg-shell">
        <div className="tn-login__brand">
          <div className="tn-sidebar__logo">🌱</div>
          <div className="tn-login__title display">{t('app.name')}</div>
        </div>

        <Card title={t('login.title')} actions={<LanguageSwitcher />}>
          <p className="lg-subtitle">{t('login.subtitle')}</p>

          <form className="tn-stack" onSubmit={onSubmit} noValidate>
            {error && (
              <div className="lg-error" role="alert" aria-live="assertive">
                <span className="lg-error__icon" aria-hidden>
                  ⚠
                </span>
                <span>{error}</span>
              </div>
            )}
            <TextField
              label={t('login.email')}
              type="email"
              autoComplete="username"
              value={email}
              onChange={setEmail}
              required
              autoFocus
              aria-invalid={error ? true : undefined}
            />
            <TextField
              label={t('login.password')}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
              required
              aria-invalid={error ? true : undefined}
            />
            <Button type="submit" block loading={submitting} className="lg-submit">
              {submitting ? t('login.signingIn') : t('login.submit')}
            </Button>
          </form>

          {isDev && (
            <div className="lg-hint">
              <span className="lg-hint__label">{demoLabel}</span>
              <code>admin@teranode.io</code>
              <span className="lg-hint__sep" aria-hidden>
                /
              </span>
              <code>teranode</code>
            </div>
          )}
        </Card>

        <p className="lg-foot">{t('app.tagline')}</p>
      </div>
    </div>
  );
}
