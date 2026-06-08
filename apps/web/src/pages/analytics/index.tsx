// TERANODE web — Cross-tenant Analytics (unit 5.W4).
// Farm picker (sourced from the admin fleet, which carries each gateway's bound
// farm + owning account) → recharts trends for GET /analytics/usage (water &
// fertilizer dose per day) + a savings stat card from GET /analytics/savings.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  Account,
  Farm,
  SavingsResponse,
  TelemetryAgg,
  UsageResponse,
} from '@teranode/types';
import { api, ApiRequestError } from '../../api/client';
import { Badge, Button, Card, PageHeader, Select, Stat } from '../../components';
import './analytics.css';

// palette pulled from CSS tokens so charts match the parchment + soil look.
const C = {
  water: '#3f78c9',
  waterSoft: '#e4edf7',
  dose: '#bd6a43',
  doseSoft: '#f2e7da',
  healthy: '#3fa564',
  border: '#e6e0d0',
  muted: '#6b6457',
  ink: '#3a352e',
  grid: '#ece6d8',
};

const WINDOWS = [
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

interface FarmOption {
  farm: Farm;
  account: Account | null;
}

// --- usage shaping ------------------------------------------------------------

interface DayPoint {
  date: string;
  label: string;
  water: number;
  dose: number;
}

/** Fold the per-(day,zone,metric) usage buckets into one row per day. */
function toDailyPoints(usage: UsageResponse | null): DayPoint[] {
  if (!usage) return [];
  const byDay = new Map<string, DayPoint>();
  for (const b of usage.buckets) {
    let row = byDay.get(b.bucket);
    if (!row) {
      const d = new Date(b.bucket);
      const label = Number.isNaN(d.getTime())
        ? b.bucket
        : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      row = { date: b.bucket, label, water: 0, dose: 0 };
      byDay.set(b.bucket, row);
    }
    if (b.kind === 'water_liters') row.water += b.total;
    else if (b.kind === 'dose_ml') row.dose += b.total;
  }
  return [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

function num(n: number, digits = 0): string {
  return n.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

// --- shared chart tooltip -----------------------------------------------------

interface TipPayload {
  name?: string;
  value?: number | string;
  color?: string;
  unit?: string;
}

function ChartTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string | number;
  payload?: TipPayload[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="an-tip">
      <div className="an-tip__label">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="an-tip__row">
          <span className="an-tip__swatch" style={{ background: p.color }} />
          <span>{p.name}</span>
          <span className="an-tip__val">
            {typeof p.value === 'number' ? num(p.value, 1) : p.value}
            {p.unit ? ` ${p.unit}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

const AXIS = { fontSize: 12, fill: C.muted } as const;

// --- page ---------------------------------------------------------------------

export default function AnalyticsPage() {
  const { t } = useTranslation();

  const [farms, setFarms] = useState<FarmOption[]>([]);
  const [farmsLoading, setFarmsLoading] = useState(true);
  const [farmsError, setFarmsError] = useState<string | null>(null);
  const [farmId, setFarmId] = useState<string>('');
  const [days, setDays] = useState('30');

  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [savings, setSavings] = useState<SavingsResponse | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // 1) Discover farms across all customers via the dedicated admin endpoint.
  useEffect(() => {
    let cancelled = false;
    setFarmsLoading(true);
    setFarmsError(null);
    api
      .getAdminFarms()
      .then((res) => {
        if (cancelled) return;
        const list = res.farms
          .map((f) => ({ farm: f.farm, account: f.account }))
          .sort((a, b) => a.farm.name.localeCompare(b.farm.name));
        setFarms(list);
        setFarmId((cur) => cur || list[0]?.farm.id || '');
      })
      .catch((e) => {
        if (cancelled) return;
        setFarmsError(e instanceof ApiRequestError ? e.message : t('common.error'));
      })
      .finally(() => {
        if (!cancelled) setFarmsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  // 2) Load usage + savings whenever the picker / window changes.
  const loadData = useCallback(() => {
    if (!farmId) return;
    setDataLoading(true);
    setDataError(null);
    const from = isoDaysAgo(Number(days));
    const agg: TelemetryAgg = '1d';
    // Admin is scoped to their own (farm-less) account unless we pass the farm's
    // owning customer accountId — without it the API 404s the customer's farm.
    const accountId = farms.find((f) => f.farm.id === farmId)?.account?.id;
    Promise.all([
      api.getUsage({ farmId, accountId, from, agg }),
      api.getSavings({ farmId, accountId, from }),
    ])
      .then(([u, s]) => {
        setUsage(u);
        setSavings(s);
      })
      .catch((e) => {
        setDataError(e instanceof ApiRequestError ? e.message : t('common.error'));
        setUsage(null);
        setSavings(null);
      })
      .finally(() => setDataLoading(false));
  }, [farmId, days, t, farms]);

  useEffect(() => loadData(), [loadData]);

  const points = useMemo(() => toDailyPoints(usage), [usage]);
  const totals = useMemo(() => {
    let water = 0;
    let dose = 0;
    for (const p of points) {
      water += p.water;
      dose += p.dose;
    }
    return { water, dose };
  }, [points]);

  const selectedFarm = farms.find((f) => f.farm.id === farmId);

  async function handleExport() {
    if (!farmId) return;
    setExporting(true);
    try {
      const accountId = farms.find((f) => f.farm.id === farmId)?.account?.id;
      const csv = await api.exportCsv({ farmId, accountId, from: isoDaysAgo(Number(days)) });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `teranode-usage-${farmId.slice(0, 8)}-${days}d.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setDataError(t('common.error'));
    } finally {
      setExporting(false);
    }
  }

  const hasData = points.length > 0;

  return (
    <>
      <PageHeader
        title={t('page.analytics.title')}
        subtitle={t('page.analytics.subtitle')}
        actions={
          <div className="an-toolbar">
            <Select
              className="an-toolbar__farm"
              aria-label="Filter by farm"
              value={farmId}
              onChange={setFarmId}
              disabled={farmsLoading || farms.length === 0}
              placeholder={farmsLoading ? t('common.loading') : 'Select a farm'}
              options={farms.map((f) => ({
                value: f.farm.id,
                label: f.account ? `${f.farm.name} — ${f.account.name}` : f.farm.name,
              }))}
            />
            <Select
              className="an-toolbar__window"
              aria-label="Time window"
              value={days}
              onChange={setDays}
              options={WINDOWS}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExport}
              loading={exporting}
              disabled={!farmId || !hasData}
              title={
                !hasData ? 'No data to export for this farm and window' : undefined
              }
            >
              Export CSV
            </Button>
          </div>
        }
      />

      {farmsError ? (
        <Card>
          <div className="tn-state tn-state--error" role="alert">
            <span className="tn-state__icon" aria-hidden="true">
              ⚠
            </span>
            <span className="tn-state__title">{t('common.error')}</span>
            <p className="tn-state__body">{farmsError}</p>
            <div className="tn-state__actions">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => window.location.reload()}
              >
                {t('common.retry')}
              </Button>
            </div>
          </div>
        </Card>
      ) : farmsLoading ? (
        <Card>
          <div className="tn-state" role="status" aria-live="polite">
            <span className="tn-spinner tn-spinner--lg" aria-hidden="true" />
            <span className="tn-state__title">{t('common.loading')}</span>
          </div>
        </Card>
      ) : farms.length === 0 ? (
        <Card>
          <div className="tn-state">
            <span className="tn-state__icon" aria-hidden="true">
              🌾
            </span>
            <span className="tn-state__title">No farms yet</span>
            <p className="tn-state__body">
              No farms are bound to a gateway yet. Once a customer claims a
              gateway and binds a farm, usage and savings will appear here.
            </p>
          </div>
        </Card>
      ) : (
        <div className="tn-stack">
          {/* savings + totals KPI row */}
          <div className="tn-grid tn-grid--stats">
            <SavingsCard savings={savings} loading={dataLoading} />
            <Stat
              label="Water used"
              value={savings ? num(savings.waterUsedL) : '—'}
              unit="L"
              hint={
                selectedFarm
                  ? `${selectedFarm.farm.name} · last ${days}d`
                  : `last ${days}d`
              }
            />
            <Stat
              label="Baseline (flood)"
              value={savings ? num(savings.baselineL) : '—'}
              unit="L"
              hint="fixed-schedule estimate"
            />
            <Stat
              label="Fertilizer dosed"
              value={num(totals.dose)}
              unit="mL"
              hint={`across ${points.length} day${points.length === 1 ? '' : 's'}`}
            />
          </div>

          {dataError && (
            <Card>
              <div className="tn-state tn-state--error" role="alert">
                <span className="tn-state__icon" aria-hidden="true">
                  ⚠
                </span>
                <span className="tn-state__title">{t('common.error')}</span>
                <p className="tn-state__body">{dataError}</p>
                <div className="tn-state__actions">
                  <Button variant="secondary" size="sm" onClick={loadData}>
                    {t('common.retry')}
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {/* water usage trend */}
          <Card
            title="Water usage per day"
            actions={
              <Badge tone="watering" dot>
                {num(totals.water)} L total
              </Badge>
            }
          >
            <ChartFrame loading={dataLoading} empty={!hasData} t={t} size="tall">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={points}
                  margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
                >
                  <defs>
                    <linearGradient id="tn-water" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.water} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={C.water} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={AXIS}
                    tickLine={false}
                    axisLine={{ stroke: C.border }}
                    minTickGap={20}
                  />
                  <YAxis
                    tick={AXIS}
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    unit="L"
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="water"
                    name="Water"
                    unit="L"
                    stroke={C.water}
                    strokeWidth={2}
                    fill="url(#tn-water)"
                    activeDot={{ r: 4 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartFrame>
          </Card>

          {/* fertilizer dose trend */}
          <Card
            title="Fertilizer dose per day"
            actions={
              <Badge tone="accent" dot>
                {num(totals.dose)} mL total
              </Badge>
            }
          >
            <ChartFrame loading={dataLoading} empty={!hasData} t={t} size="short">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={points}
                  margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
                >
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={AXIS}
                    tickLine={false}
                    axisLine={{ stroke: C.border }}
                    minTickGap={20}
                  />
                  <YAxis
                    tick={AXIS}
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    unit="mL"
                  />
                  <Tooltip
                    content={<ChartTooltip />}
                    cursor={{ fill: C.doseSoft }}
                  />
                  <Bar dataKey="dose" name="Dose" unit="mL" radius={[3, 3, 0, 0]}>
                    {points.map((_, i) => (
                      <Cell key={i} fill={C.dose} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartFrame>
          </Card>
        </div>
      )}
    </>
  );
}

// --- savings hero card --------------------------------------------------------

function SavingsCard({
  savings,
  loading,
}: {
  savings: SavingsResponse | null;
  loading: boolean;
}) {
  const pct = savings?.savedPct ?? 0;
  const tone = pct >= 40 ? C.healthy : pct >= 15 ? C.water : C.dose;
  return (
    <div className="tn-stat an-savings">
      <span className="tn-stat__label">Water saved vs baseline</span>
      <span
        className="tn-stat__value"
        style={{ color: loading || !savings ? undefined : tone }}
      >
        {loading ? (
          <span className="tn-spinner" aria-hidden="true" />
        ) : savings ? (
          `${num(pct, 1)}`
        ) : (
          '—'
        )}
        <span className="tn-stat__unit"> %</span>
      </span>
      <span className="tn-stat__hint">
        {savings
          ? `${num(savings.savedL)} L saved · ${num(savings.waterUsedL)} of ${num(
              savings.baselineL,
            )} L`
          : 'precision irrigation vs flood'}
      </span>
    </div>
  );
}

// --- chart frame (loading / empty states wrapping a recharts container) -------

function ChartFrame({
  loading,
  empty,
  t,
  size = 'short',
  children,
}: {
  loading: boolean;
  empty: boolean;
  t: (k: string) => string;
  size?: 'tall' | 'short';
  children: React.ReactNode;
}) {
  const frameClass = `an-chart an-chart--${size}`;
  if (loading) {
    return (
      <div className={frameClass}>
        <div className="an-chart__state" role="status" aria-live="polite">
          <span className="tn-spinner tn-spinner--lg" aria-hidden="true" />
          <span>{t('common.loading')}</span>
        </div>
      </div>
    );
  }
  if (empty) {
    return (
      <div className={frameClass}>
        <div className="an-chart__state">
          <span className="tn-state__icon" aria-hidden="true">
            📊
          </span>
          <span>{t('common.empty')}</span>
        </div>
      </div>
    );
  }
  return <div className={frameClass}>{children}</div>;
}
