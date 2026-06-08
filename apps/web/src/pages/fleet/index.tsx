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

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
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
import './fleet.css';

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
  delete: 'Delete',
  deleteTitle: 'Delete device',
  deleteIntro:
    'Permanently remove {{serial}} and its device tokens. Any zones it serves are detached (not deleted). This cannot be undone.',
  confirmDelete: 'Delete device',
  deleting: 'Deleting…',
  reload: 'Refresh',
  summaryTotal: 'Devices',
  summaryOnline: 'Online',
  summaryOffline: 'Offline',
  summaryClaimed: 'Claimed',
  summaryUnbound: 'In stock',
  filterAll: 'All',
  filterOnline: 'Online',
  filterOffline: 'Offline',
  filterClaimed: 'Claimed',
  filterInStock: 'In stock',
  showingCount_one: '{{count}} device',
  showingCount_other: '{{count}} devices',
  emptyTitle: 'No gateways yet',
  empty: 'No gateways registered yet. Register a serial above to get started.',
  emptyFiltered: 'No devices match this filter.',
  clearFilter: 'Clear filter',
  loadError: 'Could not load the fleet.',
};

/** Fleet-health status filter buckets (mirror the summary tiles). */
type StatusFilter = 'all' | 'online' | 'offline' | 'claimed' | 'instock';

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: COPY.filterAll },
  { key: 'online', label: COPY.filterOnline },
  { key: 'offline', label: COPY.filterOffline },
  { key: 'claimed', label: COPY.filterClaimed },
  { key: 'instock', label: COPY.filterInStock },
];

/** Does a gateway status fall into the given filter bucket? "In stock" mirrors
 *  the summary's `unbound` count, which the API folds revoked devices into. */
function matchesFilter(status: FleetGateway['gateway']['status'], filter: StatusFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'online':
      return status === 'online';
    case 'offline':
      return status === 'offline';
    case 'claimed':
      return status === 'claimed';
    case 'instock':
      return status === 'unbound' || status === 'revoked';
  }
}

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

/** A lightweight centered modal built on the Card primitive.
 *  Adds dialog semantics (role/aria-modal/labelledby), Esc-to-close, body
 *  scroll-lock, and initial focus so keyboard + screen-reader users land in
 *  the dialog rather than the page behind it. */
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
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // Lock background scroll while the dialog is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Move focus into the dialog (first focusable, else the panel itself).
    const focusable = panelRef.current?.querySelector<HTMLElement>(
      'input, select, textarea, button, [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? panelRef.current)?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="fl-overlay" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="fl-modal"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Card
          title={<span id={titleId}>{title}</span>}
          actions={
            <button type="button" className="fl-close" aria-label="Close" onClick={onClose}>
              ✕
            </button>
          }
        >
          {children}
        </Card>
      </div>
    </div>
  );
}

/** Inline error message — uses the shared danger alert so contrast + spacing
 *  match every other admin surface (replaces a hand-rolled hex pill). */
function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="tn-alert tn-alert--danger" role="alert" style={{ margin: 0 }}>
      <span className="tn-alert__icon" aria-hidden>
        !
      </span>
      <span className="tn-alert__body">{children}</span>
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
        <p className="fl-note">
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
        <div className="fl-token-serial">
          <span className="fl-muted-sm">{COPY.serial}</span>
          <code>{data.gateway.serial}</code>
        </div>
        <p className="tn-alert tn-alert--warn" role="alert" style={{ margin: 0 }}>
          <span className="tn-alert__icon" aria-hidden>⚠</span>
          <span className="tn-alert__body">{COPY.tokenWarn}</span>
        </p>
        <div className="fl-token" role="textbox" aria-readonly aria-label={COPY.tokenTitle}>
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
        <p className="fl-note">
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
          <p className="fl-note">
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
        <p className="fl-note">
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
          <p className="fl-note">
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
        <p className="fl-note">
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
          <p className="tn-alert tn-alert--success" role="status" style={{ margin: 0 }}>
            <span className="tn-alert__icon" aria-hidden>✓</span>
            <span className="tn-alert__body">
              {COPY.otaAccepted.replace('{{fw}}', accepted)}
            </span>
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

// --- delete-confirm modal -----------------------------------------------------

function DeleteModal({
  row,
  onClose,
  onDeleted,
}: {
  row: FleetGateway;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteGateway(row.gateway.id);
      onDeleted();
    } catch (err) {
      setError(errMsg(err, 'Delete failed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={COPY.deleteTitle} onClose={onClose}>
      <form className="tn-stack" onSubmit={submit}>
        <div className="fl-token-serial">
          <span className="fl-muted-sm">{COPY.serial}</span>
          <code>{row.gateway.serial}</code>
        </div>
        <p className="tn-alert tn-alert--danger" role="alert" style={{ margin: 0 }}>
          <span className="tn-alert__icon" aria-hidden>⚠</span>
          <span className="tn-alert__body">
            {COPY.deleteIntro.replace('{{serial}}', row.gateway.serial)}
          </span>
        </p>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="tn-row">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <span className="tn-spacer" />
          <Button variant="danger" type="submit" loading={busy}>
            {busy ? COPY.deleting : COPY.confirmDelete}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// --- loading skeleton ---------------------------------------------------------

/** Skeleton rows that mirror the fleet table's column rhythm, shown while the
 *  first fetch is in flight (replaces a bare "Loading…" line). */
function FleetSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="fl-skel-table" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div className="fl-skel-row" key={i}>
          <span className="tn-skeleton tn-skeleton--line" style={{ width: '70%' }} />
          <span className="tn-skeleton tn-skeleton--line" style={{ width: '60%' }} />
          <span className="tn-skeleton tn-skeleton--line" style={{ width: '50%' }} />
          <span className="tn-skeleton tn-skeleton--line" style={{ width: '80%' }} />
          <span className="tn-skeleton tn-skeleton--line" style={{ width: '45%' }} />
          <span className="tn-skeleton tn-skeleton--line" style={{ width: '55%' }} />
        </div>
      ))}
    </div>
  );
}

// --- battery cell -------------------------------------------------------------

function BatteryCell({ row }: { row: FleetGateway }) {
  if (row.nodes.length === 0) {
    return <span className="fl-muted-sm">{COPY.noNodes}</span>;
  }
  const batteries = row.nodes
    .map((n) => n.battery)
    .filter((b): b is number => typeof b === 'number');
  const min = batteries.length ? Math.min(...batteries) : null;
  const count = row.nodes.length;
  const nodeLabel = count === 1 ? '1 node' : `${count} nodes`;
  return (
    <div className="fl-battery">
      {min !== null ? (
        <Badge tone={batteryTone(min)}>
          <span className="fl-battery__pct">{min}%</span>
        </Badge>
      ) : (
        <span className="fl-muted-sm">—</span>
      )}
      <span className="fl-battery__nodes">{nodeLabel}</span>
    </div>
  );
}

// --- summary tile (clickable → drives the status filter) ----------------------

function StatTile({
  label,
  value,
  hint,
  filter,
  active,
  onSelect,
}: {
  label: string;
  value: number;
  hint?: string;
  filter: StatusFilter;
  active: StatusFilter;
  onSelect: (f: StatusFilter) => void;
}) {
  const isActive = active === filter;
  return (
    <button
      type="button"
      onClick={() => onSelect(isActive && filter !== 'all' ? 'all' : filter)}
      aria-pressed={isActive}
      title={`Filter devices: ${label}`}
      className={`fl-tile${isActive ? ' is-active' : ''}`}
    >
      <Stat label={label} value={value} hint={hint} />
    </button>
  );
}

// --- status filter bar (All / Online / Offline / Claimed / In-stock) ----------

function StatusFilterBar({
  value,
  onChange,
  count,
}: {
  value: StatusFilter;
  onChange: (f: StatusFilter) => void;
  count?: number;
}) {
  return (
    <div className="fl-toolbar">
      <div className="fl-filters" role="tablist" aria-label="Filter devices by status">
        {STATUS_FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            role="tab"
            aria-selected={value === f.key}
            variant={value === f.key ? 'secondary' : 'ghost'}
            onClick={() => onChange(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>
      {count !== undefined && (
        <span className="fl-count" aria-live="polite">
          {(count === 1 ? COPY.showingCount_one : COPY.showingCount_other).replace(
            '{{count}}',
            String(count),
          )}
        </span>
      )}
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
  const [deleteRow, setDeleteRow] = useState<FleetGateway | null>(null);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [allFarms, setAllFarms] = useState<FarmOption[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('all');
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

  // Fleet-health filter: narrow the device table to a single status bucket.
  const allRows = data?.gateways ?? [];
  const filteredRows = useMemo(
    () => allRows.filter((row) => matchesFilter(row.gateway.status, filter)),
    [allRows, filter],
  );

  const columns: Column<FleetGateway>[] = [
    {
      header: COPY.colSerial,
      cell: (row) => (
        <div className="fl-cell">
          <code className="fl-serial">{row.gateway.serial}</code>
          <span className="fl-meta">
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
      cell: (row) => <span className="fl-fw">v{row.gateway.fwVersion}</span>,
    },
    {
      header: COPY.colBinding,
      cell: (row) =>
        row.farm ? (
          <div className="fl-cell">
            <span className="fl-cell__primary">{row.farm.name}</span>
            <span className="fl-cell__secondary">{row.account?.name ?? COPY.noFarm}</span>
          </div>
        ) : row.account ? (
          // Claimed to a customer but not yet booted (no farm provisioned yet).
          <div className="fl-cell">
            <span className="fl-cell__primary">{row.account.name}</span>
            <span className="fl-cell__secondary">{COPY.claimedTo}</span>
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
        <span className="fl-muted-sm">{timeAgo(row.gateway.lastSeen)}</span>
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
          <Button size="sm" variant="danger" onClick={() => setDeleteRow(row)}>
            {COPY.delete}
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
            <StatTile
              label={COPY.summaryTotal}
              value={summary.total}
              filter="all"
              active={filter}
              onSelect={setFilter}
            />
            <StatTile
              label={COPY.summaryOnline}
              value={summary.online}
              hint={`${summary.total ? Math.round((summary.online / summary.total) * 100) : 0}% reporting`}
              filter="online"
              active={filter}
              onSelect={setFilter}
            />
            <StatTile
              label={COPY.summaryOffline}
              value={summary.offline}
              filter="offline"
              active={filter}
              onSelect={setFilter}
            />
            <StatTile
              label={COPY.summaryClaimed}
              value={summary.claimed}
              filter="claimed"
              active={filter}
              onSelect={setFilter}
            />
            <StatTile
              label={COPY.summaryUnbound}
              value={summary.unbound}
              filter="instock"
              active={filter}
              onSelect={setFilter}
            />
          </div>
        )}

        <RegisterCard onRegistered={(r) => { setToken(r); void load(); }} />

        <Card
          title={COPY.fleetTitle}
          actions={
            !loading && !error && allRows.length > 0 ? (
              <StatusFilterBar
                value={filter}
                onChange={setFilter}
                count={filteredRows.length}
              />
            ) : undefined
          }
          flush
        >
          {loading ? (
            <FleetSkeleton />
          ) : error ? (
            <div className="tn-state tn-state--error" role="alert">
              <span className="tn-state__icon" aria-hidden>
                !
              </span>
              <span className="tn-state__title">{COPY.loadError}</span>
              <p className="tn-state__body">{error}</p>
              <div className="tn-state__actions">
                <Button variant="secondary" size="sm" onClick={() => void load()}>
                  {t('common.retry')}
                </Button>
              </div>
            </div>
          ) : (
            <Table<FleetGateway>
              columns={columns}
              rows={filteredRows}
              rowKey={(row) => row.gateway.id}
              empty={
                allRows.length === 0 ? (
                  <div className="tn-state">
                    <span className="tn-state__icon" aria-hidden>
                      ▦
                    </span>
                    <span className="tn-state__title">{COPY.emptyTitle}</span>
                    <p className="tn-state__body">{COPY.empty}</p>
                  </div>
                ) : (
                  <div className="tn-state">
                    <span className="tn-state__icon" aria-hidden>
                      ⌕
                    </span>
                    <span className="tn-state__title">{COPY.emptyFiltered}</span>
                    <div className="tn-state__actions">
                      <Button variant="secondary" size="sm" onClick={() => setFilter('all')}>
                        {COPY.clearFilter}
                      </Button>
                    </div>
                  </div>
                )
              }
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
      {deleteRow && (
        <DeleteModal
          row={deleteRow}
          onClose={() => setDeleteRow(null)}
          onDeleted={() => {
            setDeleteRow(null);
            void load();
          }}
        />
      )}
    </>
  );
}
