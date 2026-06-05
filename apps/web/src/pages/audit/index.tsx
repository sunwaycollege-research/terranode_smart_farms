// TERANODE web — Audit Log (unit 5.W4).
// GET /admin/audit → table of administrative actions (actor, action, target,
// time). Rows expand to reveal a before/after JSON diff. Also offers light
// client-side filtering by action family + free-text search, and a hard limit
// selector forwarded to the API.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuditEntry } from '@teranode/types';
import { api, ApiRequestError } from '../../api/client';
import {
  Badge,
  Button,
  Card,
  PageHeader,
  Select,
  TextField,
} from '../../components';
import type { BadgeTone } from '../../components';

// --- presentation helpers -----------------------------------------------------

/** Friendly label for a dotted action slug, e.g. `customer.entitlements.update`. */
function actionLabel(action: string): string {
  return action
    .split('.')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' · ');
}

/** Tone for an action family — creates green, deletes/disables red, OTA accent. */
function actionTone(action: string): BadgeTone {
  if (/(create|register|add|bind)/.test(action)) return 'healthy';
  if (/(delete|remove|revoke|disable)/.test(action)) return 'critical';
  if (/ota/.test(action)) return 'accent';
  if (/(update|patch|edit|entitlement)/.test(action)) return 'watering';
  return 'neutral';
}

/** Top-level group of an action, used to drive the family filter. */
function actionGroup(action: string): string {
  return action.split('.')[0] ?? action;
}

/** Format an ISO timestamp into a compact, locale-aware date + time. */
function formatTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: iso, time: '' };
  return {
    date: d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }),
    time: d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  };
}

function shortId(id: string | null | undefined): string {
  if (!id) return '—';
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

// --- before/after diff --------------------------------------------------------

type DiffStatus = 'added' | 'removed' | 'changed' | 'same';

interface DiffRow {
  key: string;
  before: unknown;
  after: unknown;
  status: DiffStatus;
}

function stringify(v: unknown): string {
  if (v === undefined) return '';
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Compute a flat key-level diff between two JSON objects. */
function computeDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): DiffRow[] {
  const keys = new Set<string>([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  const rows: DiffRow[] = [];
  for (const key of [...keys].sort()) {
    const b = before ? before[key] : undefined;
    const a = after ? after[key] : undefined;
    const hadB = before != null && key in before;
    const hadA = after != null && key in after;
    let status: DiffStatus;
    if (!hadB && hadA) status = 'added';
    else if (hadB && !hadA) status = 'removed';
    else status = stringify(b) === stringify(a) ? 'same' : 'changed';
    rows.push({ key, before: b, after: a, status });
  }
  return rows;
}

const DIFF_DOT: Record<DiffStatus, string> = {
  added: 'var(--healthy)',
  removed: 'var(--critical)',
  changed: 'var(--warn)',
  same: 'var(--border-strong)',
};

function AuditDiff({ entry }: { entry: AuditEntry }) {
  const { t } = useTranslation();
  const rows = useMemo(
    () => computeDiff(entry.before, entry.after),
    [entry.before, entry.after],
  );

  if (entry.before == null && entry.after == null) {
    return (
      <p className="tn-muted" style={{ margin: 0, fontSize: 13 }}>
        {t('common.empty')}
      </p>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(120px, 0.6fr) 1fr 1fr',
        gap: '1px',
        background: 'var(--border-soft)',
        border: '1px solid var(--border-soft)',
        borderRadius: 'var(--r2)',
        overflow: 'hidden',
        fontSize: 13,
      }}
    >
      {(['field', 'before', 'after'] as const).map((h) => (
        <div
          key={h}
          style={{
            background: 'var(--surface-2)',
            padding: '8px 12px',
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: 'var(--muted)',
          }}
        >
          {h}
        </div>
      ))}
      {rows.map((r) => (
        <DiffCells key={r.key} row={r} />
      ))}
    </div>
  );
}

function DiffCells({ row }: { row: DiffRow }) {
  const dim = row.status === 'same';
  const cell = (content: string, side: 'before' | 'after') => {
    const isChange =
      (side === 'before' && (row.status === 'removed' || row.status === 'changed')) ||
      (side === 'after' && (row.status === 'added' || row.status === 'changed'));
    return (
      <div
        className="mono"
        style={{
          background: 'var(--surface)',
          padding: '8px 12px',
          color: dim ? 'var(--subtle)' : 'var(--ink-soft)',
          fontWeight: isChange ? 600 : 400,
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        {content || <span style={{ color: 'var(--subtle)' }}>—</span>}
      </div>
    );
  };
  return (
    <>
      <div
        style={{
          background: 'var(--surface)',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontWeight: 500,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: DIFF_DOT[row.status],
            flex: 'none',
          }}
        />
        {row.key}
      </div>
      {cell(stringify(row.before), 'before')}
      {cell(stringify(row.after), 'after')}
    </>
  );
}

// --- page ---------------------------------------------------------------------

const LIMITS = [50, 100, 250, 500];

export default function AuditPage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(100);
  const [group, setGroup] = useState('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    api
      .getAudit({ limit })
      .then((res) => setEntries(res.entries))
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setError(e instanceof ApiRequestError ? e.message : t('common.error'));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [limit, t]);

  useEffect(() => load(), [load]);

  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) set.add(actionGroup(e.action));
    return [...set].sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (group !== 'all' && actionGroup(e.action) !== group) return false;
      if (!q) return true;
      return (
        e.action.toLowerCase().includes(q) ||
        (e.target ?? '').toLowerCase().includes(q) ||
        (e.actorId ?? '').toLowerCase().includes(q) ||
        (e.accountId ?? '').toLowerCase().includes(q)
      );
    });
  }, [entries, group, query]);

  return (
    <>
      <PageHeader
        title={t('page.audit.title')}
        subtitle={t('page.audit.subtitle')}
        actions={
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            {t('common.retry')}
          </Button>
        }
      />

      <Card
        flush
        title={
          <span>
            {filtered.length} {filtered.length === 1 ? 'event' : 'events'}
          </span>
        }
        actions={
          <div className="tn-row" style={{ gap: 'var(--sp-sm)' }}>
            <div style={{ minWidth: 200 }}>
              <TextField
                placeholder={t('common.search')}
                value={query}
                onChange={setQuery}
              />
            </div>
            <Select
              aria-label="Action family"
              value={group}
              onChange={setGroup}
              options={[
                { value: 'all', label: 'All actions' },
                ...groups.map((g) => ({
                  value: g,
                  label: g.charAt(0).toUpperCase() + g.slice(1),
                })),
              ]}
            />
            <Select
              aria-label="Row limit"
              value={String(limit)}
              onChange={(v) => setLimit(Number(v))}
              options={LIMITS.map((n) => ({ value: String(n), label: `Last ${n}` }))}
            />
          </div>
        }
      >
        {error ? (
          <div className="tn-table__empty">
            <p style={{ color: 'var(--critical)', marginBottom: 12 }}>{error}</p>
            <Button variant="secondary" size="sm" onClick={load}>
              {t('common.retry')}
            </Button>
          </div>
        ) : loading ? (
          <div className="tn-table__empty">{t('common.loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="tn-table__empty">{t('common.empty')}</div>
        ) : (
          <div className="tn-table-wrap">
            <table className="tn-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }} />
                  <th>Action</th>
                  <th>Target</th>
                  <th>Actor</th>
                  <th>Account</th>
                  <th style={{ width: 180 }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => {
                  const isOpen = expanded === e.id;
                  const time = formatTime(e.ts);
                  const hasDiff = e.before != null || e.after != null;
                  return (
                    <AuditRowFragment
                      key={e.id}
                      entry={e}
                      isOpen={isOpen}
                      hasDiff={hasDiff}
                      time={time}
                      onToggle={() =>
                        setExpanded((cur) => (cur === e.id ? null : e.id))
                      }
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function AuditRowFragment({
  entry,
  isOpen,
  hasDiff,
  time,
  onToggle,
}: {
  entry: AuditEntry;
  isOpen: boolean;
  hasDiff: boolean;
  time: { date: string; time: string };
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="tn-table__row--clickable"
        onClick={onToggle}
        style={isOpen ? { background: 'var(--surface-2)' } : undefined}
      >
        <td style={{ textAlign: 'center' }}>
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              color: 'var(--muted)',
              transition: 'transform 0.14s ease',
              transform: isOpen ? 'rotate(90deg)' : 'none',
            }}
          >
            ▸
          </span>
        </td>
        <td>
          <Badge tone={actionTone(entry.action)} dot>
            {actionLabel(entry.action)}
          </Badge>
        </td>
        <td className="mono" style={{ color: 'var(--ink-soft)' }}>
          {entry.target ?? <span className="tn-muted">—</span>}
        </td>
        <td className="mono tn-muted" title={entry.actorId ?? undefined}>
          {shortId(entry.actorId)}
        </td>
        <td className="mono tn-muted" title={entry.accountId ?? undefined}>
          {shortId(entry.accountId)}
        </td>
        <td>
          <span style={{ fontWeight: 500 }}>{time.date}</span>{' '}
          <span className="mono tn-muted" style={{ fontSize: 12 }}>
            {time.time}
          </span>
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={6} style={{ background: 'var(--bg-warm)', padding: 'var(--sp-lg) var(--sp-xl)' }}>
            {hasDiff ? (
              <AuditDiff entry={entry} />
            ) : (
              <p className="tn-muted" style={{ margin: 0, fontSize: 13 }}>
                No recorded before/after state for this action.
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
