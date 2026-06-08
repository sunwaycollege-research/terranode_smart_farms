// TERANODE web — unit 5.W1. Customer detail: account info + owner, a farms/gateways
// summary (derived from GET /admin/fleet), and a freely-editable entitlement editor.
// Enable/disable via PATCH /admin/customers/:id; entitlements via .../entitlements.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type {
  CustomerWithEntitlements,
  DeviceCatalogItem,
  Entitlements,
  FleetGateway,
} from '@teranode/types';
import { api, ApiRequestError } from '../../api/client';
import {
  accountStatusTone,
  Badge,
  Button,
  Card,
  Select,
  TextField,
} from '../../components';
import { useLanguage } from '../../i18n/useLanguage';
import { EntitlementEditor } from './EntitlementEditor';
import { CUSTOMERS_NS } from './i18n';

function entitlementsEqual(a: Entitlements, b: Entitlements): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}

export function CustomerDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation(CUSTOMERS_NS);
  const { language } = useLanguage();

  const [data, setData] = useState<CustomerWithEntitlements | null>(null);
  const [catalog, setCatalog] = useState<DeviceCatalogItem[]>([]);
  const [fleet, setFleet] = useState<FleetGateway[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // editable account fields
  const [name, setName] = useState('');
  const [plan, setPlan] = useState('');
  const [locale, setLocale] = useState('en');

  // editable entitlements
  const [values, setValues] = useState<Entitlements>({});

  const [savingAccount, setSavingAccount] = useState(false);
  const [savingEnt, setSavingEnt] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<'ok' | 'warn'>('ok');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [detail, cat, fleetResp] = await Promise.all([
        api.getCustomer(id),
        api.getDeviceCatalog(),
        api.getFleet().catch(() => null),
      ]);
      setData(detail);
      setCatalog(cat.items);
      setFleet(fleetResp ? fleetResp.gateways : []);
      setName(detail.account.name);
      setPlan(detail.account.plan ?? '');
      setLocale(detail.account.locale ?? 'en');
      setValues({ ...detail.entitlements });
    } catch (err) {
      setLoadError(
        err instanceof ApiRequestError && err.status === 404
          ? t('detail.notFound')
          : err instanceof ApiRequestError
            ? err.message
            : t('detail.notFound'),
      );
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Localized date formatter.
  const fmtDate = useMemo(
    () => new Intl.DateTimeFormat(language === 'ne' ? 'ne-NP' : 'en-GB', { dateStyle: 'medium' }),
    [language],
  );

  // Per-customer farms/gateways summary derived from the fleet.
  const summary = useMemo(() => {
    const mine = fleet.filter((g) => g.account?.id === id);
    const farms = new Set<string>();
    let online = 0;
    let nodes = 0;
    for (const g of mine) {
      if (g.farm) farms.add(g.farm.id);
      if (g.gateway.status === 'online') online += 1;
      nodes += g.nodes.length;
    }
    return { farms: mine.map((g) => g.farm).filter(Boolean), farmCount: farms.size, gateways: mine, online, nodes };
  }, [fleet, id]);

  const accountDirty =
    !!data &&
    (name.trim() !== data.account.name ||
      (plan.trim() || '') !== (data.account.plan ?? '') ||
      locale !== (data.account.locale ?? 'en'));

  const entDirty = !!data && !entitlementsEqual(values, data.entitlements);

  async function saveAccount() {
    if (!data || !accountDirty) return;
    setSavingAccount(true);
    setNotice(null);
    try {
      const updated = await api.updateCustomer(data.account.id, {
        name: name.trim(),
        plan: plan.trim() || undefined,
        locale,
      });
      setData({ ...data, account: updated });
      setNoticeTone('ok');
      setNotice(t('detail.accountSaved'));
    } catch (err) {
      setNoticeTone('warn');
      setNotice(err instanceof ApiRequestError ? err.message : t('detail.error'));
    } finally {
      setSavingAccount(false);
    }
  }

  async function toggleStatus() {
    if (!data) return;
    setTogglingStatus(true);
    setNotice(null);
    const next = data.account.status === 'active' ? 'disabled' : 'active';
    try {
      const updated = await api.updateCustomer(data.account.id, { status: next });
      setData({ ...data, account: updated });
      setNoticeTone('ok');
      setNotice(next === 'active' ? t('detail.enabledNote') : t('detail.disabledDone'));
    } catch (err) {
      setNoticeTone('warn');
      setNotice(err instanceof ApiRequestError ? err.message : t('detail.error'));
    } finally {
      setTogglingStatus(false);
    }
  }

  async function saveEntitlements() {
    if (!data || !entDirty) return;
    setSavingEnt(true);
    setNotice(null);
    try {
      const record = await api.updateEntitlements(data.account.id, { values });
      setData({ ...data, entitlements: record.values });
      setValues({ ...record.values });
      setNoticeTone('ok');
      setNotice(t('ent.saved'));
    } catch (err) {
      setNoticeTone('warn');
      setNotice(err instanceof ApiRequestError ? err.message : t('detail.error'));
    } finally {
      setSavingEnt(false);
    }
  }

  if (loading) {
    return (
      <div>
        <button className="cu-backlink" onClick={() => navigate('/customers')}>
          ← {t('detail.back')}
        </button>
        <div className="tn-pageheader" aria-hidden>
          <div className="cu-name">
            <span className="tn-skeleton cu-skel-avatar cu-skel-avatar--lg" />
            <div className="cu-name__meta" style={{ gap: 8 }}>
              <span className="tn-skeleton tn-skeleton--title" style={{ width: 200 }} />
              <span className="tn-skeleton tn-skeleton--text" style={{ width: 120 }} />
            </div>
          </div>
        </div>
        <div className="cu-detail" aria-hidden>
          <div className="tn-stack">
            <Card>
              <div className="tn-stack">
                <span className="tn-skeleton tn-skeleton--block" />
                <span className="tn-skeleton tn-skeleton--line" />
                <span className="tn-skeleton tn-skeleton--line" style={{ width: '70%' }} />
              </div>
            </Card>
            <Card>
              <div className="tn-stack tn-stack--sm">
                <span className="tn-skeleton tn-skeleton--line" style={{ width: '80%' }} />
                <span className="tn-skeleton tn-skeleton--line" style={{ width: '55%' }} />
              </div>
            </Card>
          </div>
          <Card>
            <div className="tn-stack">
              <span className="tn-skeleton tn-skeleton--block" />
              <span className="tn-skeleton tn-skeleton--block" />
              <span className="tn-skeleton tn-skeleton--block" />
            </div>
          </Card>
        </div>
        <span className="tn-visually-hidden" role="status">
          {t('detail.loading')}
        </span>
      </div>
    );
  }
  if (loadError || !data) {
    const notFound = !data || loadError === t('detail.notFound');
    return (
      <div>
        <button className="cu-backlink" onClick={() => navigate('/customers')}>
          ← {t('detail.back')}
        </button>
        <Card>
          <div className="tn-state tn-state--error" role="alert">
            <span className="tn-state__icon" aria-hidden>
              {notFound ? '∅' : '!'}
            </span>
            <p className="tn-state__title">
              {notFound ? t('detail.notFound') : t('detail.errorTitle')}
            </p>
            {!notFound && <p className="tn-state__body">{loadError}</p>}
            <div className="tn-state__actions">
              {!notFound && (
                <Button variant="secondary" size="sm" onClick={() => void load()}>
                  {t('translation:common.retry')}
                </Button>
              )}
              <Button
                variant={notFound ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => navigate('/customers')}
              >
                {t('detail.back')}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const { account, user } = data;
  const isActive = account.status === 'active';

  return (
    <div>
      <button className="cu-backlink" onClick={() => navigate('/customers')}>
        ← {t('detail.back')}
      </button>

      <header className="tn-pageheader">
        <div className="cu-name">
          <span className="cu-avatar cu-avatar--lg">{account.name.slice(0, 2)}</span>
          <div>
            <h1 className="tn-pageheader__title" style={{ fontSize: 30 }}>
              {account.name}
            </h1>
            <div className="tn-row" style={{ marginTop: 4 }}>
              <Badge tone={accountStatusTone(account.status)} dot>
                {isActive ? t('translation:common.active') : t('translation:common.disabled')}
              </Badge>
              {account.plan && <Badge tone="accent">{account.plan}</Badge>}
            </div>
          </div>
        </div>
        <div className="tn-pageheader__actions">
          <Button
            variant={isActive ? 'danger' : 'primary'}
            loading={togglingStatus}
            onClick={toggleStatus}
          >
            {isActive ? t('detail.disable') : t('detail.enable')}
          </Button>
        </div>
      </header>

      {!isActive && (
        <div className="cu-notice cu-notice--warn" role="status">
          <span className="cu-notice__icon" aria-hidden>
            ⚠
          </span>
          <span>{t('detail.disabledNote')}</span>
        </div>
      )}
      {notice && (
        <div
          className={`cu-notice cu-notice--${noticeTone}`}
          role={noticeTone === 'warn' ? 'alert' : 'status'}
          aria-live="polite"
        >
          <span className="cu-notice__icon" aria-hidden>
            {noticeTone === 'warn' ? '⚠' : '✓'}
          </span>
          <span>{notice}</span>
        </div>
      )}

      <div className="cu-detail">
        {/* Account + owner + summary */}
        <div className="tn-stack">
          <Card title={t('detail.account')}>
            <div className="tn-stack">
              <TextField label={t('detail.fields.name')} value={name} onChange={setName} />
              <div className="cu-formgrid">
                <TextField label={t('detail.fields.plan')} value={plan} onChange={setPlan} />
                <Select
                  label={t('detail.fields.locale')}
                  value={locale}
                  onChange={setLocale}
                  options={[
                    { value: 'en', label: 'English' },
                    { value: 'ne', label: 'नेपाली' },
                  ]}
                />
              </div>
              <dl className="cu-dl">
                <dt>{t('detail.fields.id')}</dt>
                <dd className="cu-mono cu-dim">{account.id}</dd>
                <dt>{t('detail.fields.created')}</dt>
                <dd>{fmtDate.format(new Date(account.createdAt))}</dd>
              </dl>
              <div className="tn-row">
                <span className="tn-spacer" />
                <Button
                  variant="secondary"
                  loading={savingAccount}
                  disabled={!accountDirty}
                  onClick={saveAccount}
                >
                  {t('detail.saveAccount')}
                </Button>
              </div>
            </div>
          </Card>

          <Card title={t('detail.owner')}>
            {user ? (
              <dl className="cu-dl">
                <dt>{t('detail.fields.ownerName')}</dt>
                <dd>{user.name}</dd>
                <dt>{t('detail.fields.ownerEmail')}</dt>
                <dd className="cu-mono">{user.email}</dd>
                <dt>{t('detail.fields.ownerRole')}</dt>
                <dd>
                  <Badge>{user.role}</Badge>
                </dd>
              </dl>
            ) : (
              <p className="tn-muted" style={{ margin: 0 }}>
                {t('list.noOwner')}
              </p>
            )}
          </Card>

          <Card title={t('detail.summary')}>
            <div className="cu-summary">
              <div className="cu-mini">
                <span className="cu-mini__value">{summary.farmCount}</span>
                <span className="cu-mini__label">
                  {t('detail.farms', { count: summary.farmCount })}
                </span>
              </div>
              <div className="cu-mini">
                <span className="cu-mini__value">{summary.gateways.length}</span>
                <span className="cu-mini__label">
                  {t('detail.gateways', { count: summary.gateways.length })}
                </span>
              </div>
              <div className="cu-mini">
                <span className="cu-mini__value">{summary.online}</span>
                <span className="cu-mini__label">{t('detail.online', { count: summary.online })}</span>
              </div>
              <div className="cu-mini">
                <span className="cu-mini__value">{summary.nodes}</span>
                <span className="cu-mini__label">{t('detail.nodes', { count: summary.nodes })}</span>
              </div>
            </div>
            {summary.gateways.length === 0 && (
              <p className="tn-muted" style={{ marginBottom: 0, marginTop: 'var(--sp-md)' }}>
                {t('detail.noGateways')}
              </p>
            )}
          </Card>
        </div>

        {/* Entitlement editor */}
        <Card
          title={t('ent.title')}
          actions={
            <Button loading={savingEnt} disabled={!entDirty} onClick={saveEntitlements}>
              {t('ent.save')}
            </Button>
          }
        >
          <p className="tn-muted" style={{ marginTop: 0, marginBottom: 'var(--sp-lg)' }}>
            {t('ent.subtitle')}
          </p>
          <EntitlementEditor catalog={catalog} values={values} onChange={setValues} />
        </Card>
      </div>
    </div>
  );
}
