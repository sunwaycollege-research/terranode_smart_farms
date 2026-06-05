// TERANODE web — unit 5.W2: gateway fleet + register + bind + OTA.
//
// One self-contained admin page driven by the API surface (spec §5):
//   GET  /admin/fleet              → fleet table + summary stats
//   POST /admin/gateways           → register a serial, reveal the one-time device token
//   POST /admin/gateways/:id/bind  → attach an unbound gateway to a farm
//   POST /admin/gateways/:id/ota   → push a firmware version to a gateway
//
// All DTOs come from @teranode/types via the shared `api` client; visuals reuse the
// parchment + soil component primitives (Card / Table / Badge / Button / fields).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ComputeKind,
  FleetGateway,
  FleetResponse,
  Gateway,
  RegisterGatewayResponse,
} from '@teranode/types';
import {
  Badge,
  Button,
  Card,
  deviceStatusLabel,
  gatewayStatusTone,
  PageHeader,
  Select,
  Stat,
  Table,
  TextField,
  type Column,
} from '../../components';
import { api, ApiRequestError } from '../../api/client';

// --- local copy (fleet-specific strings live here; i18n bundle is owned elsewhere) --

const COPY = {
  register: 'Register device',
  registerHint: 'Add a flashed ESP32/RPi to inventory. A one-time device token is issued once — flash it onto the device alongside the serial.',
  serial: 'Serial',
  serialPlaceholder: 'TN-ESP32-0042',
  model: 'Model',
  modelPlaceholder: 'TN-BRAIN-3Z',
  compute: 'Compute',
  issueToken: 'Register + issue token',
  issuing: 'Registering…',
  claim: 'Claim',
  claimTitle: 'Claim device to customer',
  claimIntro: 'Link {{serial}} to a customer account. On first boot the device auto-provisions their farm and starts streaming — no manual pairing.',
  customer: 'Customer',
  pickCustomer: 'Select a customer…',
  noCustomers: 'No customers yet — create one first.',
  confirmClaim: 'Claim device',
  claiming: 'Claiming…',
  inStock: 'In stock',
  claimedTo: 'Claimed to',
  fleetTitle: 'Gateways',
  colSerial: 'Serial',
  colStatus: 'Status',
  colFirmware: 'Firmware',
  colBinding: 'Bound to',
  colNode: 'Node',
  colLastSeen: 'Last seen',
  colActions: '',
  unbound: 'Unbound',
  noFarm: '— unassigned —',
  bind: 'Bind',
  rebind: 'Re-bind',
  ota: 'OTA',
  battery: 'Battery',
  noNodes: 'No nodes',
  nodeCount_one: '{{count}} node',
  nodeCount_other: '{{count}} nodes',
  tokenTitle: 'Device token issued',
  tokenWarn:
    'Copy this token now — it is shown once and cannot be retrieved again. Flash it onto the gateway to authenticate it.',
  copy: 'Copy',
  copied: 'Copied',
  done: 'Done',
  bindTitle: 'Bind gateway to a farm',
  bindIntro: 'Attach {{serial}} to a farm. The gateway will be scoped to that customer.',
  farm: 'Farm',
  pickFarm: 'Select a farm…',
  noFarms:
    'No farms are visible yet. Once a customer creates a farm and binds a gateway, it will appear here. You can also paste a farm ID directly.',
  farmId: 'Farm ID',
  farmIdHint: 'Paste a farm UUID to bind to a farm not yet listed.',
  confirmBind: 'Bind gateway',
  binding: 'Binding…',
  otaTitle: 'Push firmware (OTA)',
  otaIntro: 'Deploy a target firmware version to {{serial}} (currently {{fw}}).',
  targetFw: 'Target version',
  fwPlaceholder: '1.4.0',
  pushOta: 'Push update',
  pushing: 'Pushing…',
  otaAccepted: 'Update accepted — gateway will fetch {{fw}} on next check-in.',
  reload: 'Refresh',
  summaryTotal: 'Devices',
  summaryOnline: 'Online',
  summaryOffline: 'Offline',
  summaryClaimed: 'Claimed',
  summaryUnbound: 'In stock',
  empty: 'No gateways registered yet. Register a serial to get started.',
  loadError: 'Could not load the fleet.',
};

const COMPUTE_OPTIONS = [
  { value: 'esp32', label: 'ESP32' },
  { value: 'rpi4', label: 'Raspberry Pi 4' },
];

// --- helpers ------------------------------------------------------------------

/** Human "time ago" for a last-seen timestamp. */
function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 0) return 'just now';
  if (secs < 45) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

/** Battery tone by remaining %. */
function batteryTone(pct: number) {
  if (pct <= 15) return 'critical' as const;
  if (pct <= 35) return 'warn' as const;
  return 'healthy' as const;
}

// --- small inline UI ----------------------------------------------------------

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 40,
  display: 'grid',
  placeItems: 'center',
  padding: 'var(--sp-xl)',
  background: 'rgba(26, 25, 22, 0.42)',
  backdropFilter: 'blur(2px)',
};

/** A lightweight centered modal built on the Card primitive. */
function Modal({
  title,
  onClose,
  children,
  width = 460,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div style={overlayStyle} onMouseDown={onClose}>
      <div style={{ width: '100%', maxWidth: width }} onMouseDown={(e) => e.stopPropagation()}>
        <Card title={title} actions={<Button variant="ghost" size="sm" onClick={onClose}>✕</Button>}>
          {children}
        </Card>
      </div>
    </div>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: 0,
        padding: '9px 12px',
        borderRadius: 'var(--r2)',
        background: 'var(--critical-soft)',
        color: '#9a3a2e',
        fontSize: 13,
      }}
    >
      {children}
    </p>
  );
}

function errMsg(e: unknown, fallback: string): string {
  if (e instanceof ApiRequestError) return e.message;
  if (e instanceof Error) return e.message;
  return fallback;
}

// --- register form ------------------------------------------------------------

function RegisterCard({ onRegistered }: { onRegistered: (r: RegisterGatewayResponse) => void }) {
  const [serial, setSerial] = useState('');
  const [model, setModel] = useState('');
  const [compute, setCompute] = useState<ComputeKind>('esp32');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = serial.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.registerGateway({
        serial: trimmed,
        compute,
        model: model.trim() || undefined,
      });
      setSerial('');
      setModel('');
      setCompute('esp32');
      onRegistered(res);
    } catch (err) {
      setError(errMsg(err, 'Registration failed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={COPY.register}>
      <form className="tn-stack" onSubmit={submit}>
        <p className="tn-muted" style={{ margin: 0, fontSize: 13 }}>
          {COPY.registerHint}
        </p>
        <div className="tn-grid tn-grid--2" style={{ alignItems: 'end' }}>
          <TextField
            label={COPY.serial}
            placeholder={COPY.serialPlaceholder}
            value={serial}
            onChange={setSerial}
            autoCapitalize="characters"
            spellCheck={false}
          />
          <TextField
            label={COPY.model}
            placeholder={COPY.modelPlaceholder}
            value={model}
            onChange={setModel}
            spellCheck={false}
          />
        </div>
        <Select
          label={COPY.compute}
          options={COMPUTE_OPTIONS}
          value={compute}
          onChange={(v) => setCompute(v as ComputeKind)}
        />
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="tn-row">
          <Button type="submit" loading={busy} disabled={!serial.trim()}>
            {busy ? COPY.issuing : COPY.issueToken}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// --- token reveal modal -------------------------------------------------------

function TokenModal({
  data,
  onClose,
}: {
  data: RegisterGatewayResponse;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.deviceToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — token is still visible to copy manually */
    }
  };

  return (
    <Modal title={COPY.tokenTitle} onClose={onClose} width={520}>
      <div className="tn-stack">
        <div className="tn-row" style={{ gap: 'var(--sp-sm)' }}>
          <span className="tn-muted" style={{ fontSize: 13 }}>{COPY.serial}</span>
          <code style={{ fontWeight: 600 }}>{data.gateway.serial}</code>
        </div>
        <ErrorNote>{COPY.tokenWarn}</ErrorNote>
        <div
          style={{
            padding: 'var(--sp-md) var(--sp-lg)',
            borderRadius: 'var(--r2)',
            border: '1px dashed var(--border-strong)',
            background: 'var(--surface-2)',
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            wordBreak: 'break-all',
            color: 'var(--ink)',
          }}
        >
          {data.deviceToken}
        </div>
        <div className="tn-row">
          <Button variant="secondary" onClick={copy}>
            {copied ? COPY.copied : COPY.copy}
          </Button>
          <span className="tn-spacer" />
          <Button onClick={onClose}>{COPY.done}</Button>
        </div>
      </div>
    </Modal>
  );
}

// --- bind modal ---------------------------------------------------------------

interface FarmOption {
  id: string;
  name: string;
  account: string | null;
}

function BindModal({
  row,
  farms,
  onClose,
  onBound,
}: {
  row: FleetGateway;
  farms: FarmOption[];
  onClose: () => void;
  onBound: (gw: Gateway) => void;
}) {
  const knownFarms = farms.filter((f) => f.id !== row.farm?.id);
  const [farmId, setFarmId] = useState(knownFarms[0]?.id ?? '');
  const [manualId, setManualId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveId = (farmId || manualId).trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const gw = await api.bindGateway(row.gateway.id, { farmId: effectiveId });
      onBound(gw);
    } catch (err) {
      setError(errMsg(err, 'Bind failed.'));
    } finally {
      setBusy(false);
    }
  };

  const farmOptions = knownFarms.map((f) => ({
    value: f.id,
    label: f.account ? `${f.name} · ${f.account}` : f.name,
  }));

  return (
    <Modal title={COPY.bindTitle} onClose={onClose}>
      <form className="tn-stack" onSubmit={submit}>
        <p className="tn-muted" style={{ margin: 0, fontSize: 13 }}>
          {COPY.bindIntro.replace('{{serial}}', row.gateway.serial)}
        </p>
        {farmOptions.length > 0 ? (
          <Select
            label={COPY.farm}
            placeholder={COPY.pickFarm}
            options={farmOptions}
            value={farmId}
            onChange={(v) => {
              setFarmId(v);
              setManualId('');
            }}
          />
        ) : (
          <p className="tn-muted" style={{ margin: 0, fontSize: 13 }}>
            {COPY.noFarms}
          </p>
        )}
        <TextField
          label={COPY.farmId}
          hint={COPY.farmIdHint}
          placeholder="00000000-0000-0000-0000-000000000000"
          value={manualId}
          onChange={(v) => {
            setManualId(v);
            if (v) setFarmId('');
          }}
          spellCheck={false}
        />
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="tn-row">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <span className="tn-spacer" />
          <Button type="submit" loading={busy} disabled={!effectiveId}>
            {busy ? COPY.binding : COPY.confirmBind}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// --- claim modal --------------------------------------------------------------

interface CustomerOption {
  id: string;
  name: string;
}

function ClaimModal({
  row,
  customers,
  onClose,
  onClaimed,
}: {
  row: FleetGateway;
  customers: CustomerOption[];
  onClose: () => void;
  onClaimed: (gw: Gateway) => void;
}) {
  const [accountId, setAccountId] = useState(customers[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const gw = await api.claimDevice(row.gateway.serial, { accountId });
      onClaimed(gw);
    } catch (err) {
      setError(errMsg(err, 'Claim failed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={COPY.claimTitle} onClose={onClose}>
      <form className="tn-stack" onSubmit={submit}>
        <p className="tn-muted" style={{ margin: 0, fontSize: 13 }}>
          {COPY.claimIntro.replace('{{serial}}', row.gateway.serial)}
        </p>
        {customers.length > 0 ? (
          <Select
            label={COPY.customer}
            placeholder={COPY.pickCustomer}
            options={customers.map((c) => ({ value: c.id, label: c.name }))}
            value={accountId}
            onChange={setAccountId}
          />
        ) : (
          <p className="tn-muted" style={{ margin: 0, fontSize: 13 }}>
            {COPY.noCustomers}
          </p>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="tn-row">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <span className="tn-spacer" />
          <Button type="submit" loading={busy} disabled={!accountId}>
            {busy ? COPY.claiming : COPY.confirmClaim}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// --- OTA modal ----------------------------------------------------------------

function OtaModal({
  row,
  onClose,
  onPushed,
}: {
  row: FleetGateway;
  onClose: () => void;
  onPushed: (gw: Gateway) => void;
}) {
  const [fw, setFw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = fw.trim();
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.otaGateway(row.gateway.id, { fwVersion: target });
      onPushed(res.gateway);
      setAccepted(res.gateway.fwVersion);
    } catch (err) {
      setError(errMsg(err, 'OTA push failed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={COPY.otaTitle} onClose={onClose}>
      <form className="tn-stack" onSubmit={submit}>
        <p className="tn-muted" style={{ margin: 0, fontSize: 13 }}>
          {COPY.otaIntro
            .replace('{{serial}}', row.gateway.serial)
            .replace('{{fw}}', row.gateway.fwVersion)}
        </p>
        <TextField
          label={COPY.targetFw}
          placeholder={COPY.fwPlaceholder}
          value={fw}
          onChange={(v) => {
            setFw(v);
            setAccepted(null);
          }}
          spellCheck={false}
          autoFocus
        />
        {error && <ErrorNote>{error}</ErrorNote>}
        {accepted && (
          <p
            style={{
              margin: 0,
              padding: '9px 12px',
              borderRadius: 'var(--r2)',
              background: 'var(--healthy-soft)',
              color: '#2f7d4b',
              fontSize: 13,
            }}
          >
            {COPY.otaAccepted.replace('{{fw}}', accepted)}
          </p>
        )}
        <div className="tn-row">
          <Button variant="ghost" type="button" onClick={onClose}>
            {accepted ? COPY.done : 'Cancel'}
          </Button>
          <span className="tn-spacer" />
          <Button type="submit" loading={busy} disabled={!fw.trim()}>
            {busy ? COPY.pushing : COPY.pushOta}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// --- battery cell -------------------------------------------------------------

function BatteryCell({ row }: { row: FleetGateway }) {
  if (row.nodes.length === 0) {
    return <span className="tn-muted" style={{ fontSize: 13 }}>{COPY.noNodes}</span>;
  }
  const batteries = row.nodes
    .map((n) => n.battery)
    .filter((b): b is number => typeof b === 'number');
  const min = batteries.length ? Math.min(...batteries) : null;
  const count = row.nodes.length;
  const nodeLabel = count === 1 ? '1 node' : `${count} nodes`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {min !== null ? (
        <Badge tone={batteryTone(min)}>
          <span style={{ fontFamily: 'var(--font-mono)' }}>{min}%</span>
        </Badge>
      ) : (
        <span className="tn-muted" style={{ fontSize: 13 }}>—</span>
      )}
      <span className="tn-muted" style={{ fontSize: 11 }}>{nodeLabel}</span>
    </div>
  );
}

// --- page ---------------------------------------------------------------------

export default function FleetPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<FleetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<RegisterGatewayResponse | null>(null);
  const [bindRow, setBindRow] = useState<FleetGateway | null>(null);
  const [otaRow, setOtaRow] = useState<FleetGateway | null>(null);
  const [claimRow, setClaimRow] = useState<FleetGateway | null>(null);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [allFarms, setAllFarms] = useState<FarmOption[]>([]);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.getFleet();
      if (mounted.current) setData(res);
    } catch (err) {
      if (mounted.current) setError(errMsg(err, COPY.loadError));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  // Customer options for the claim picker + the full farm list for the bind picker.
  useEffect(() => {
    let alive = true;
    api
      .listCustomers()
      .then((r) => {
        if (alive) {
          setCustomers(r.customers.map((c) => ({ id: c.account.id, name: c.account.name })));
        }
      })
      .catch(() => {
        /* non-fatal — the claim modal will show "no customers" */
      });
    api
      .getAdminFarms()
      .then((r) => {
        if (alive) {
          setAllFarms(
            r.farms.map((f) => ({ id: f.farm.id, name: f.farm.name, account: f.account?.name ?? null })),
          );
        }
      })
      .catch(() => {
        /* non-fatal — bind modal falls back to fleet-derived farms */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Farm options for the bind picker: prefer the dedicated /admin/farms list;
  // fall back to deriving from currently-bound gateways if that call failed.
  const farmOptions: FarmOption[] = useMemo(() => {
    if (allFarms.length > 0) {
      return [...allFarms].sort((a, b) => a.name.localeCompare(b.name));
    }
    const map = new Map<string, FarmOption>();
    for (const row of data?.gateways ?? []) {
      if (row.farm) {
        map.set(row.farm.id, {
          id: row.farm.id,
          name: row.farm.name,
          account: row.account?.name ?? null,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data, allFarms]);

  // Optimistically merge an updated gateway into the table after bind/OTA.
  const patchGateway = useCallback((gw: Gateway) => {
    setData((prev) => {
      if (!prev) return prev;
      let matchedFarm: FleetGateway | undefined;
      const gateways = prev.gateways.map((row) => {
        if (row.gateway.id !== gw.id) {
          if (!matchedFarm && row.farm?.id === gw.farmId) matchedFarm = row;
          return row;
        }
        return row;
      });
      const next = gateways.map((row) =>
        row.gateway.id === gw.id
          ? {
              ...row,
              gateway: gw,
              farm: matchedFarm?.farm ?? row.farm,
              account: matchedFarm?.account ?? row.account,
            }
          : row,
      );
      return { ...prev, gateways: next };
    });
    // Re-pull to reconcile derived farm/account + summary against the server.
    void load();
  }, [load]);

  const summary = data?.summary;

  const columns: Column<FleetGateway>[] = [
    {
      header: COPY.colSerial,
      cell: (row) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <code style={{ fontWeight: 600 }}>{row.gateway.serial}</code>
          <span className="tn-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {row.gateway.model ? `${row.gateway.model} · ${row.gateway.compute}` : row.gateway.compute}
          </span>
        </div>
      ),
    },
    {
      header: COPY.colStatus,
      cell: (row) => (
        <Badge tone={gatewayStatusTone(row.gateway.status)} dot>
          {deviceStatusLabel(row.gateway.status)}
        </Badge>
      ),
    },
    {
      header: COPY.colFirmware,
      cell: (row) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
          v{row.gateway.fwVersion}
        </span>
      ),
    },
    {
      header: COPY.colBinding,
      cell: (row) =>
        row.farm ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontWeight: 500 }}>{row.farm.name}</span>
            <span className="tn-muted" style={{ fontSize: 12 }}>
              {row.account?.name ?? COPY.noFarm}
            </span>
          </div>
        ) : row.account ? (
          // Claimed to a customer but not yet booted (no farm provisioned yet).
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontWeight: 500 }}>{row.account.name}</span>
            <span className="tn-muted" style={{ fontSize: 12 }}>{COPY.claimedTo}</span>
          </div>
        ) : (
          <Badge tone="offline">{COPY.inStock}</Badge>
        ),
    },
    {
      header: COPY.battery,
      cell: (row) => <BatteryCell row={row} />,
    },
    {
      header: COPY.colLastSeen,
      cell: (row) => (
        <span className="tn-muted" style={{ fontSize: 13 }}>{timeAgo(row.gateway.lastSeen)}</span>
      ),
    },
    {
      header: COPY.colActions,
      align: 'right',
      cell: (row) => (
        <div className="tn-row" style={{ justifyContent: 'flex-end', gap: 'var(--sp-sm)' }}>
          {row.gateway.status === 'unbound' && (
            <Button size="sm" onClick={() => setClaimRow(row)}>
              {COPY.claim}
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => setBindRow(row)}>
            {row.farm ? COPY.rebind : COPY.bind}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOtaRow(row)}>
            {COPY.ota}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('page.fleet.title')}
        subtitle={t('page.fleet.subtitle')}
        actions={
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {COPY.reload}
          </Button>
        }
      />

      <div className="tn-stack">
        {summary && (
          <div className="tn-grid tn-grid--stats">
            <Stat label={COPY.summaryTotal} value={summary.total} />
            <Stat
              label={COPY.summaryOnline}
              value={summary.online}
              hint={`${summary.total ? Math.round((summary.online / summary.total) * 100) : 0}% reporting`}
            />
            <Stat label={COPY.summaryOffline} value={summary.offline} />
            <Stat label={COPY.summaryClaimed} value={summary.claimed} />
            <Stat label={COPY.summaryUnbound} value={summary.unbound} />
          </div>
        )}

        <RegisterCard onRegistered={(r) => { setToken(r); void load(); }} />

        <Card title={COPY.fleetTitle} flush>
          {loading ? (
            <p className="tn-muted" style={{ padding: 'var(--sp-xl)' }}>{t('common.loading')}</p>
          ) : error ? (
            <div style={{ padding: 'var(--sp-xl)' }} className="tn-stack">
              <ErrorNote>{error}</ErrorNote>
              <div>
                <Button variant="secondary" size="sm" onClick={() => void load()}>
                  {t('common.retry')}
                </Button>
              </div>
            </div>
          ) : (
            <Table<FleetGateway>
              columns={columns}
              rows={data?.gateways ?? []}
              rowKey={(row) => row.gateway.id}
              empty={COPY.empty}
            />
          )}
        </Card>
      </div>

      {token && <TokenModal data={token} onClose={() => setToken(null)} />}
      {bindRow && (
        <BindModal
          row={bindRow}
          farms={farmOptions}
          onClose={() => setBindRow(null)}
          onBound={(gw) => {
            patchGateway(gw);
            setBindRow(null);
          }}
        />
      )}
      {otaRow && (
        <OtaModal
          row={otaRow}
          onClose={() => setOtaRow(null)}
          onPushed={(gw) => patchGateway(gw)}
        />
      )}
      {claimRow && (
        <ClaimModal
          row={claimRow}
          customers={customers}
          onClose={() => setClaimRow(null)}
          onClaimed={(gw) => {
            patchGateway(gw);
            setClaimRow(null);
          }}
        />
      )}
    </>
  );
}
