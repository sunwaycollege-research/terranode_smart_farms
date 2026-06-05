// TERANODE web — unit 5.W1. Create-customer wizard (modal).
// Step 1 account & owner → Step 2 device modules (catalog grid) → Step 3 review
// → POST /admin/customers → reveal the owner credentials (shown once).
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  defaultEntitlements,
  type CreateCustomerResponse,
  type DeviceCatalogItem,
  type Entitlements,
} from '@teranode/types';
import { api, ApiRequestError } from '../../api/client';
import { Button, Select, Switch, TextField } from '../../components';
import { EntitlementEditor } from './EntitlementEditor';
import { CUSTOMERS_NS } from './i18n';

export interface CreateCustomerWizardProps {
  catalog: DeviceCatalogItem[];
  onClose: () => void;
  /** Called after a successful create so the list can refresh. */
  onCreated: (result: CreateCustomerResponse) => void;
  /** Navigate to the new customer's detail page. */
  onView: (id: string) => void;
}

type FieldErrors = Partial<Record<'name' | 'ownerName' | 'ownerEmail' | 'password', string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STEP_KEYS = ['account', 'modules', 'review'] as const;

export function CreateCustomerWizard({
  catalog,
  onClose,
  onCreated,
  onView,
}: CreateCustomerWizardProps) {
  const { t } = useTranslation(CUSTOMERS_NS);

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [plan, setPlan] = useState('');
  const [locale, setLocale] = useState('en');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [password, setPassword] = useState('');
  const [values, setValues] = useState<Entitlements>(() => defaultEntitlements());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreateCustomerResponse | null>(null);
  const [copied, setCopied] = useState<'email' | 'password' | null>(null);

  // Close on Escape (unless we're showing the one-time credentials).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !created) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, created]);

  const labelByKey = useMemo(() => {
    const m: Record<string, DeviceCatalogItem> = {};
    for (const c of catalog) m[c.key] = c;
    return m;
  }, [catalog]);

  const enabledModules = useMemo(
    () =>
      Object.entries(values)
        .filter(([, v]) => (typeof v === 'number' ? v > 0 : Boolean(v)))
        .map(([k, v]) => ({
          key: k,
          label: labelByKey[k]?.label ?? k,
          isCount: labelByKey[k]?.kind === 'count',
          value: v,
        })),
    [values, labelByKey],
  );

  function validateAccount(): boolean {
    const next: FieldErrors = {};
    if (!name.trim()) next.name = t('wizard.errors.name');
    if (!ownerName.trim()) next.ownerName = t('wizard.errors.ownerName');
    if (!EMAIL_RE.test(ownerEmail.trim())) next.ownerEmail = t('wizard.errors.ownerEmail');
    if (password.length < 6) next.password = t('wizard.errors.password');
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function goNext() {
    setSubmitError(null);
    if (step === 0 && !validateAccount()) return;
    setStep((s) => Math.min(STEP_KEYS.length - 1, s + 1));
  }

  function goPrev() {
    setSubmitError(null);
    setStep((s) => Math.max(0, s - 1));
  }

  async function submit() {
    if (!validateAccount()) {
      setStep(0);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await api.createCustomer({
        name: name.trim(),
        userName: ownerName.trim(),
        userEmail: ownerEmail.trim(),
        password,
        plan: plan.trim() || undefined,
        locale,
        entitlements: values,
      });
      setCreated(result);
      onCreated(result);
    } catch (err) {
      const msg =
        err instanceof ApiRequestError ? err.message : t('wizard.errors.submit');
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setStep(0);
    setName('');
    setPlan('');
    setLocale('en');
    setOwnerName('');
    setOwnerEmail('');
    setPassword('');
    setValues(defaultEntitlements());
    setErrors({});
    setSubmitError(null);
    setCreated(null);
    setCopied(null);
  }

  async function copy(kind: 'email' | 'password', text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }

  // --- one-time credential reveal -------------------------------------------
  if (created) {
    return (
      <div className="cu-overlay" role="dialog" aria-modal="true">
        <div className="cu-modal">
          <div className="cu-modal__body" style={{ textAlign: 'center' }}>
            <div className="cu-done__icon" aria-hidden>
              ✓
            </div>
            <div className="cu-modal__title">{t('wizard.done.title')}</div>
            <p className="cu-modal__sub" style={{ marginBottom: 'var(--sp-xl)' }}>
              {t('wizard.done.lead')}
            </p>

            <div style={{ textAlign: 'left' }}>
              <div className="cu-cred">
                <span className="cu-cred__label">{t('wizard.done.email')}</span>
                <div className="cu-cred__row">
                  <span className="cu-cred__value">{created.user.email}</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => copy('email', created.user.email)}
                  >
                    {copied === 'email' ? t('wizard.done.copied') : t('wizard.done.copy')}
                  </Button>
                </div>
              </div>
              <div className="cu-cred">
                <span className="cu-cred__label">{t('wizard.done.password')}</span>
                <div className="cu-cred__row">
                  <span className="cu-cred__value">{password}</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => copy('password', password)}
                  >
                    {copied === 'password'
                      ? t('wizard.done.copied')
                      : t('wizard.done.copy')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
          <div className="cu-modal__foot">
            <Button variant="ghost" type="button" onClick={onClose}>
              {t('wizard.done.close')}
            </Button>
            <Button variant="secondary" type="button" onClick={reset}>
              {t('wizard.done.another')}
            </Button>
            <span className="tn-spacer" />
            <Button type="button" onClick={() => onView(created.account.id)}>
              {t('wizard.done.view')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // --- wizard ---------------------------------------------------------------
  return (
    <div
      className="cu-overlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cu-modal">
        <div className="cu-modal__head">
          <div className="cu-modal__title">{t('wizard.title')}</div>
          <div className="cu-modal__sub">{t('wizard.subtitle')}</div>
          <div className="cu-steps">
            {STEP_KEYS.map((key, i) => (
              <span key={key} style={{ display: 'contents' }}>
                {i > 0 && <span className="cu-steps__bar" />}
                <span
                  className={[
                    'cu-steps__item',
                    i === step ? 'is-active' : '',
                    i < step ? 'is-done' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className="cu-steps__num">{i < step ? '✓' : i + 1}</span>
                  {t(`wizard.steps.${key}`)}
                </span>
              </span>
            ))}
          </div>
        </div>

        <div className="cu-modal__body">
          {step === 0 && (
            <div className="tn-stack">
              <TextField
                label={t('wizard.fields.name')}
                placeholder={t('wizard.fields.namePh')}
                value={name}
                onChange={setName}
                error={errors.name}
                autoFocus
              />
              <div className="cu-formgrid">
                <TextField
                  label={t('wizard.fields.plan')}
                  placeholder={t('wizard.fields.planPh')}
                  value={plan}
                  onChange={setPlan}
                />
                <Select
                  label={t('wizard.fields.locale')}
                  value={locale}
                  onChange={setLocale}
                  options={[
                    { value: 'en', label: 'English' },
                    { value: 'ne', label: 'नेपाली' },
                  ]}
                />
              </div>
              <div className="cu-formgrid">
                <TextField
                  label={t('wizard.fields.ownerName')}
                  placeholder={t('wizard.fields.ownerNamePh')}
                  value={ownerName}
                  onChange={setOwnerName}
                  error={errors.ownerName}
                />
                <TextField
                  label={t('wizard.fields.ownerEmail')}
                  type="email"
                  placeholder={t('wizard.fields.ownerEmailPh')}
                  value={ownerEmail}
                  onChange={setOwnerEmail}
                  error={errors.ownerEmail}
                />
              </div>
              <TextField
                label={t('wizard.fields.password')}
                type="text"
                placeholder={t('wizard.fields.passwordPh')}
                value={password}
                onChange={setPassword}
                error={errors.password}
              />
            </div>
          )}

          {step === 1 && (
            <EntitlementEditor catalog={catalog} values={values} onChange={setValues} />
          )}

          {step === 2 && (
            <div>
              <div className="cu-review__group">
                <div className="cu-review__title">{t('wizard.review.account')}</div>
                <dl className="cu-dl">
                  <dt>{t('wizard.fields.name')}</dt>
                  <dd>{name.trim()}</dd>
                  {plan.trim() && (
                    <>
                      <dt>{t('wizard.fields.plan')}</dt>
                      <dd>{plan.trim()}</dd>
                    </>
                  )}
                  <dt>{t('wizard.fields.locale')}</dt>
                  <dd>{locale === 'ne' ? 'नेपाली' : 'English'}</dd>
                </dl>
              </div>
              <div className="cu-review__group">
                <div className="cu-review__title">{t('wizard.review.owner')}</div>
                <dl className="cu-dl">
                  <dt>{t('wizard.fields.ownerName')}</dt>
                  <dd>{ownerName.trim()}</dd>
                  <dt>{t('wizard.fields.ownerEmail')}</dt>
                  <dd className="cu-mono">{ownerEmail.trim()}</dd>
                </dl>
              </div>
              <div className="cu-review__group">
                <div className="cu-review__title">{t('wizard.review.modules')}</div>
                {enabledModules.length === 0 ? (
                  <p className="tn-muted" style={{ margin: 0 }}>
                    {t('wizard.review.none')}
                  </p>
                ) : (
                  <div className="cu-chips">
                    {enabledModules.map((m) => (
                      <span key={m.key} className="tn-badge tn-badge--healthy">
                        {m.label}
                        {m.isCount ? ` · ${m.value}` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {submitError && (
                <div className="cu-notice cu-notice--warn" style={{ marginBottom: 0 }}>
                  {submitError}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="cu-modal__foot">
          {step > 0 ? (
            <Button variant="ghost" type="button" onClick={goPrev}>
              {t('wizard.prev')}
            </Button>
          ) : (
            <Button variant="ghost" type="button" onClick={onClose}>
              {t('wizard.done.close')}
            </Button>
          )}
          <span className="tn-spacer" />
          {step < STEP_KEYS.length - 1 ? (
            <Button type="button" onClick={goNext}>
              {t('wizard.next')}
            </Button>
          ) : (
            <Button type="button" loading={submitting} onClick={submit}>
              {submitting ? t('wizard.creating') : t('wizard.submit')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
