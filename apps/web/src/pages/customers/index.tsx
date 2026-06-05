// TERANODE web — unit 5.W1. Customers: list + create wizard + detail.
// Mounted at /customers/* (see router.tsx). Internal routes:
//   index            → list (search + table; row click → detail; "New customer" → wizard)
//   :id              → CustomerDetail (account, summary, entitlement editor, enable/disable)
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type {
  CustomerWithEntitlements,
  DeviceCatalogItem,
} from '@teranode/types';
import { api, ApiRequestError } from '../../api/client';
import {
  accountStatusTone,
  Badge,
  Button,
  Card,
  PageHeader,
  Table,
} from '../../components';
import type { Column } from '../../components';
import { useLanguage } from '../../i18n/useLanguage';
import { CreateCustomerWizard } from './CreateCustomerWizard';
import { CustomerDetail } from './CustomerDetail';
import { CUSTOMERS_NS } from './i18n';
import './customers.css';

/** Count how many of a customer's entitlements are "on". */
function moduleCount(c: CustomerWithEntitlements, catalog: DeviceCatalogItem[]) {
  let on = 0;
  for (const item of catalog) {
    const v = c.entitlements[item.key];
    const enabled = typeof v === 'number' ? v > 0 : Boolean(v);
    if (enabled) on += 1;
  }
  return { on, total: catalog.length };
}

function CustomersList() {
  const { t } = useTranslation(CUSTOMERS_NS);
  const navigate = useNavigate();
  const { language } = useLanguage();

  const [customers, setCustomers] = useState<CustomerWithEntitlements[]>([]);
  const [catalog, setCatalog] = useState<DeviceCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, cat] = await Promise.all([
        api.listCustomers(),
        api.getDeviceCatalog(),
      ]);
      setCustomers(list.customers);
      setCatalog(cat.items);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('detail.error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const fmtDate = useMemo(
    () =>
      new Intl.DateTimeFormat(language === 'ne' ? 'ne-NP' : 'en-GB', {
        dateStyle: 'medium',
      }),
    [language],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      const hay = [
        c.account.name,
        c.account.plan ?? '',
        c.user?.email ?? '',
        c.user?.name ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [customers, query]);

  const columns: Column<CustomerWithEntitlements>[] = useMemo(
    () => [
      {
        header: t('list.col.name'),
        cell: (c) => (
          <div className="cu-name">
            <span className="cu-avatar">{c.account.name.slice(0, 2)}</span>
            <div className="cu-name__meta">
              <span className="cu-name__primary">{c.account.name}</span>
              <span className="cu-name__sub cu-mono">{c.account.id.slice(0, 8)}</span>
            </div>
          </div>
        ),
      },
      {
        header: t('list.col.status'),
        cell: (c) => (
          <Badge tone={accountStatusTone(c.account.status)} dot>
            {c.account.status === 'active'
              ? t('translation:common.active')
              : t('translation:common.disabled')}
          </Badge>
        ),
      },
      {
        header: t('list.col.plan'),
        cell: (c) =>
          c.account.plan ? (
            <Badge tone="accent">{c.account.plan}</Badge>
          ) : (
            <span className="cu-dim">{t('list.noPlan')}</span>
          ),
      },
      {
        header: t('list.col.owner'),
        cell: (c) =>
          c.user ? (
            <span className="cu-mono">{c.user.email}</span>
          ) : (
            <span className="cu-dim">{t('list.noOwner')}</span>
          ),
      },
      {
        header: t('list.col.modules'),
        align: 'center',
        cell: (c) => {
          const { on, total } = moduleCount(c, catalog);
          return <Badge tone={on > 0 ? 'healthy' : 'neutral'}>{t('list.modulesOn', { on, total })}</Badge>;
        },
      },
      {
        header: t('list.col.created'),
        align: 'right',
        cell: (c) => (
          <span className="cu-dim">{fmtDate.format(new Date(c.account.createdAt))}</span>
        ),
      },
    ],
    [t, catalog, fmtDate],
  );

  return (
    <>
      <PageHeader
        title={t('translation:page.customers.title')}
        subtitle={t('translation:page.customers.subtitle')}
        actions={
          <Button onClick={() => setWizardOpen(true)} icon={<span aria-hidden>+</span>}>
            {t('list.new')}
          </Button>
        }
      />

      <div className="cu-toolbar">
        <div className="cu-search">
          <span className="cu-search__icon" aria-hidden>
            ⌕
          </span>
          <input
            type="search"
            placeholder={t('list.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t('list.search')}
          />
        </div>
        <span className="tn-muted">{t('list.count', { count: filtered.length })}</span>
      </div>

      {error ? (
        <Card>
          <div className="tn-stack" style={{ alignItems: 'flex-start' }}>
            <p className="tn-muted" style={{ margin: 0 }}>
              {error}
            </p>
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              {t('translation:common.retry')}
            </Button>
          </div>
        </Card>
      ) : (
        <Card flush>
          <Table<CustomerWithEntitlements>
            columns={columns}
            rows={loading ? [] : filtered}
            rowKey={(c) => c.account.id}
            onRowClick={(c) => navigate(`/customers/${c.account.id}`)}
            empty={
              loading
                ? t('detail.loading')
                : query.trim()
                  ? t('list.noMatch', { q: query.trim() })
                  : t('list.empty')
            }
          />
        </Card>
      )}

      {wizardOpen && (
        <CreateCustomerWizard
          catalog={catalog}
          onClose={() => setWizardOpen(false)}
          onCreated={() => {
            void load();
          }}
          onView={(id) => {
            setWizardOpen(false);
            navigate(`/customers/${id}`);
          }}
        />
      )}
    </>
  );
}

export default function CustomersPage() {
  return (
    <Routes>
      <Route index element={<CustomersList />} />
      <Route path=":id" element={<CustomerDetail />} />
    </Routes>
  );
}
