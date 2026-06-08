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
import './audit.css';

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
    return <p className="au-detail__empty">{t('common.empty')}</p>;
  }

  return (
    <div className="au-diff">
      {(['field', 'before', 'after'] as const).map((h) => (
        <div key={h} className="au-diff__head">
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
      (side === 'before' &&
        (row.status === 'removed' || row.status === 'changed')) ||
      (side === 'after' && (row.status === 'added' || row.status === 'changed'));
    const classes = [
      'au-diff__cell',
      'mono',
      dim ? 'au-diff__cell--same' : '',
      isChange ? 'au-diff__cell--change' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <div className={classes}>
        {content || <span className="au-diff__nil">—</span>}
      </div>
    );
  };
  return (
    <>
      <div className="au-diff__field">
        <span
          className="au-diff__dot"
          style={{ background: DIFF_DOT[row.status] }}
        />
        {row.key}
      </div>
      {cell(stringify(row.before), 'before')}
      {cell(stringify(row.after), 'after')}
    </>
  );
}

// --- loading skeleton ---------------------------------------------------------

/** Placeholder rows shown while the first page of entries loads. */
function AuditSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="tn-table-wrap" aria-hidden>
      <table className="tn-table au-table">
        <thead>
          <tr>
            <th className="au-caret-cell" />
            <th>Action</th>
            <th>Target</th>
            <th>Actor</th>
            <th>Account</th>
            <th style={{ width: 180 }}>Time</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <tr key={i} className="au-skel-row">
              <td className="au-caret-cell" />
              <td>
                <span className="tn-skeleton au-skel au-skel--badge" />
              </td>
              <td>
                <span className="tn-skeleton au-skel au-skel--id" />
              </td>
              <td>
                <span className="tn-skeleton au-skel au-skel--id" />
              </td>
              <td>
                <span className="tn-skeleton au-skel au-skel--id" />
              </td>
              <td>
                <span className="tn-skeleton au-skel au-skel--time" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

  const isFiltering = group !== 'all' || query.trim().length > 0;
  const clearFilters = () => {
    setGroup('all');
    setQuery('');
  };

  return (
    <>
      <PageHeader
        title={t('page.audit.title')}
        subtitle={t('page.audit.subtitle')}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={load}
            loading={loading}
          >
            {t('common.retry')}
          </Button>
        }
      />

      <Card
        flush
        title={
          <span className="au-count">
            {loading ? (
              <span
                className="tn-skeleton tn-skeleton--text"
                style={{ width: 96, display: 'inline-block' }}
              />
            ) : (
              `${filtered.length} ${filtered.length === 1 ? 'event' : 'events'}`
            )}
          </span>
        }
        actions={
          <div className="au-toolbar">
            <div className="au-search">
              <TextField
                aria-label={t('common.search')}
                placeholder={t('common.search')}
                value={query}
                onChange={setQuery}
                disabled={loading || !!error}
              />
            </div>
            <Select
              aria-label="Action family"
              value={group}
              onChange={setGroup}
              disabled={loading || !!error}
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
              disabled={loading || !!error}
              options={LIMITS.map((n) => ({
                value: String(n),
                label: `Last ${n}`,
              }))}
            />
          </div>
        }
      >
        {error ? (
          <div className="tn-state tn-state--error" role="alert">
            <span className="tn-state__icon" aria-hidden>
              !
            </span>
            <p className="tn-state__title">{t('common.error')}</p>
            <p className="tn-state__body">{error}</p>
            <div className="tn-state__actions">
              <Button variant="secondary" size="sm" onClick={load}>
                {t('common.retry')}
              </Button>
            </div>
          </div>
        ) : loading ? (
          <AuditSkeleton />
        ) : filtered.length === 0 ? (
          isFiltering ? (
            <div className="tn-state">
              <span className="tn-state__icon" aria-hidden>
                ⌕
              </span>
              <p className="tn-state__title">No matching events</p>
              <p className="tn-state__body">
                No audit events match the current filter. Try a broader search
                or a different action family.
              </p>
              <div className="tn-state__actions">
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              </div>
            </div>
          ) : (
            <div className="tn-state">
              <span className="tn-state__icon" aria-hidden>
                ☑
              </span>
              <p className="tn-state__title">No activity yet</p>
              <p className="tn-state__body">
                Administrative actions will appear here as soon as they happen.
              </p>
            </div>
          )
        ) : (
          <div className="tn-table-wrap">
            <table className="tn-table au-table">
              <thead>
                <tr>
                  <th className="au-caret-cell" aria-hidden />
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
  const detailId = `au-detail-${entry.id}`;
  return (
    <>
      <tr
        className={[
          'tn-table__row--clickable',
          isOpen ? 'au-table__row--open' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={onToggle}
        tabIndex={0}
        role="button"
        aria-expanded={isOpen}
        aria-controls={isOpen ? detailId : undefined}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            onToggle();
          }
        }}
      >
        <td className="au-caret-cell">
          <span
            aria-hidden
            className={['au-caret', isOpen ? 'is-open' : '']
              .filter(Boolean)
              .join(' ')}
          >
            ▸
          </span>
        </td>
        <td>
          <Badge tone={actionTone(entry.action)} dot>
            {actionLabel(entry.action)}
          </Badge>
        </td>
        <td className="au-id au-id--target">
          {entry.target ?? <span className="au-id--dim">—</span>}
        </td>
        <td className="au-id au-id--dim" title={entry.actorId ?? undefined}>
          {shortId(entry.actorId)}
        </td>
        <td className="au-id au-id--dim" title={entry.accountId ?? undefined}>
          {shortId(entry.accountId)}
        </td>
        <td>
          <span className="au-time">
            <span className="au-time__date">{time.date}</span>
            <span className="au-time__clock">{time.time}</span>
          </span>
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td id={detailId} className="au-detail-cell" colSpan={6}>
            {hasDiff ? (
              <AuditDiff entry={entry} />
            ) : (
              <p className="au-detail__empty">
                No recorded before/after state for this action.
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
