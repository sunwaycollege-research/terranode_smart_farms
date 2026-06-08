// TERANODE web — unit 5.W1. Customers: list + create wizard + detail.
// Mounted at /customers/* (see router.tsx). Internal routes:
//   index            → list (search + table; row click → detail; "New customer" → wizard)
//   :id              → CustomerDetail (account, summary, entitlement editor, enable/disable)
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Route, Routes, useNavigate, useParams } from 'react-router-dom';
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

/** Skeleton rows that mirror the customer table while the list loads. */
function CustomerListSkeleton({ columns }: { columns: number }) {
  return (
    <div className="tn-table-wrap" aria-hidden>
      <table className="tn-table">
        <tbody>
          {Array.from({ length: 6 }).map((_, ri) => (
            <tr key={ri} className="cu-skel-row">
              <td>
                <div className="cu-name">
                  <span className="tn-skeleton cu-skel-avatar" />
                  <div className="cu-name__meta" style={{ flex: 1 }}>
                    <span className="tn-skeleton tn-skeleton--text" style={{ width: '60%' }} />
                    <span className="tn-skeleton tn-skeleton--text" style={{ width: '32%' }} />
                  </div>
                </div>
              </td>
              {Array.from({ length: Math.max(0, columns - 1) }).map((__, ci) => (
                <td key={ci}>
                  <span className="tn-skeleton tn-skeleton--text" style={{ width: '64%' }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
          {query && (
            <button
              type="button"
              className="cu-search__clear"
              onClick={() => setQuery('')}
              aria-label={t('list.clearSearch')}
            >
              ✕
            </button>
          )}
        </div>
        <span className="tn-muted tn-nowrap">
          {loading ? (
            <span className="tn-skeleton tn-skeleton--text" style={{ width: 84, display: 'inline-block' }} />
          ) : (
            t('list.count', { count: filtered.length })
          )}
        </span>
      </div>

      {error ? (
        <Card>
          <div className="tn-state tn-state--error" role="alert">
            <span className="tn-state__icon" aria-hidden>
              !
            </span>
            <p className="tn-state__title">{t('list.errorTitle')}</p>
            <p className="tn-state__body">{error}</p>
            <div className="tn-state__actions">
              <Button variant="secondary" size="sm" onClick={() => void load()}>
                {t('translation:common.retry')}
              </Button>
            </div>
          </div>
        </Card>
      ) : loading ? (
        <Card flush>
          <CustomerListSkeleton columns={columns.length} />
        </Card>
      ) : (
        <Card flush>
          <Table<CustomerWithEntitlements>
            columns={columns}
            rows={filtered}
            rowKey={(c) => c.account.id}
            onRowClick={(c) => navigate(`/customers/${c.account.id}`)}
            empty={
              query.trim() ? (
                <div className="tn-state">
                  <span className="tn-state__icon" aria-hidden>
                    ⌕
                  </span>
                  <p className="tn-state__title">{t('list.noMatchTitle')}</p>
                  <p className="tn-state__body">{t('list.noMatch', { q: query.trim() })}</p>
                  <div className="tn-state__actions">
                    <Button variant="secondary" size="sm" onClick={() => setQuery('')}>
                      {t('list.clearSearch')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="tn-state">
                  <span className="tn-state__icon" aria-hidden>
                    ☺
                  </span>
                  <p className="tn-state__title">{t('list.emptyTitle')}</p>
                  <p className="tn-state__body">{t('list.empty')}</p>
                  <div className="tn-state__actions">
                    <Button size="sm" onClick={() => setWizardOpen(true)} icon={<span aria-hidden>+</span>}>
                      {t('list.new')}
                    </Button>
                  </div>
                </div>
              )
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

/**
 * Detail route: the existing CustomerDetail plus a destructive "Danger zone"
 * card that permanently deletes the customer (and all their farms, devices, and
 * telemetry). Confirms before deleting, then returns to the list on success.
 */
function CustomerDetailRoute() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation(CUSTOMERS_NS);

  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Grab the display name so the confirm prompt can name what is destroyed.
  useEffect(() => {
    let alive = true;
    api
      .getCustomer(id)
      .then((c) => {
        if (alive) setName(c.account.name);
      })
      .catch(() => {
        /* CustomerDetail surfaces its own load error; the prompt falls back to the id. */
      });
    return () => {
      alive = false;
    };
  }, [id]);

  async function handleDelete() {
    if (deleting) return;
    const label = name || id;
    if (!window.confirm(t('detail.deleteConfirm', { name: label }))) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteCustomer(id);
      // Row is gone — go back to the (reloading) list.
      navigate('/customers');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('detail.deleteError'));
      setDeleting(false);
    }
  }

  return (
    <div>
      <CustomerDetail />
      <div className="cu-detail" style={{ marginTop: 'var(--sp-lg)' }}>
        <Card title={t('detail.dangerZone')}>
          <p className="tn-muted" style={{ marginTop: 0, marginBottom: 'var(--sp-lg)' }}>
            {t('detail.dangerLead')}
          </p>
          {error && (
            <div className="cu-notice cu-notice--warn" role="alert" aria-live="polite">
              <span className="cu-notice__icon" aria-hidden>
                ⚠
              </span>
              <span>{error}</span>
            </div>
          )}
          <div className="tn-row">
            <Button variant="danger" loading={deleting} onClick={handleDelete}>
              {deleting ? t('detail.deleting') : t('detail.delete')}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function CustomersPage() {
  return (
    <Routes>
      <Route index element={<CustomersList />} />
      <Route path=":id" element={<CustomerDetailRoute />} />
    </Routes>
  );
}
