// TERANODE web — unit 5.W1. Device-catalog entitlement grid.
// Count modules (kind === 'count') render a stepper; toggle modules render a Switch.
// Pure controlled component: parent owns the values map. No lock — admins always edit.
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  DeviceCatalogCategory,
  DeviceCatalogItem,
  Entitlements,
  EntitlementValue,
} from '@teranode/types';
import { Switch } from '../../components';
import { CUSTOMERS_NS } from './i18n';

export interface EntitlementEditorProps {
  catalog: DeviceCatalogItem[];
  values: Entitlements;
  onChange: (next: Entitlements) => void;
  disabled?: boolean;
}

const CATEGORY_ORDER: DeviceCatalogCategory[] = ['sensing', 'actuation', 'platform'];

/** Coerce a stored entitlement value to a count >= 0 for stepper modules. */
function asCount(v: EntitlementValue | undefined, fallback: EntitlementValue): number {
  const raw = typeof v === 'number' ? v : typeof fallback === 'number' ? fallback : 0;
  return Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0;
}

/** Coerce a stored entitlement value to a boolean for toggle modules. */
function asBool(v: EntitlementValue | undefined, fallback: EntitlementValue): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v > 0;
  return Boolean(fallback);
}

function Stepper({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="cu-stepper" role="group">
      <button
        type="button"
        aria-label="decrease"
        disabled={disabled || value <= 0}
        onClick={() => onChange(Math.max(0, value - 1))}
      >
        −
      </button>
      <span className="cu-stepper__value mono">{value}</span>
      <button
        type="button"
        aria-label="increase"
        disabled={disabled || value >= 99}
        onClick={() => onChange(Math.min(99, value + 1))}
      >
        +
      </button>
    </div>
  );
}

export function EntitlementEditor({
  catalog,
  values,
  onChange,
  disabled,
}: EntitlementEditorProps) {
  const { t } = useTranslation(CUSTOMERS_NS);

  const grouped = useMemo(() => {
    const by: Record<string, DeviceCatalogItem[]> = {};
    for (const item of catalog) (by[item.category] ??= []).push(item);
    return CATEGORY_ORDER.filter((c) => by[c]?.length).map((c) => ({
      category: c,
      items: by[c],
    }));
  }, [catalog]);

  function set(key: string, value: EntitlementValue) {
    onChange({ ...values, [key]: value });
  }

  return (
    <div>
      {grouped.map(({ category, items }) => (
        <div key={category}>
          <div className="cu-ent__cat">{t(`ent.category.${category}`)}</div>
          <div className="cu-ent__grid">
            {items.map((item) => {
              const isCount = item.kind === 'count';
              const count = asCount(values[item.key], item.defaultValue);
              const on = isCount ? count > 0 : asBool(values[item.key], item.defaultValue);
              return (
                <div
                  key={item.key}
                  className={['cu-ent__item', on ? 'is-on' : ''].filter(Boolean).join(' ')}
                >
                  <div className="cu-ent__meta">
                    <span className="cu-ent__label">{item.label}</span>
                    {item.hint && <span className="cu-ent__hint">{item.hint}</span>}
                  </div>
                  {isCount ? (
                    <Stepper
                      value={count}
                      disabled={disabled}
                      onChange={(v) => set(item.key, v)}
                    />
                  ) : (
                    <Switch
                      checked={on}
                      disabled={disabled}
                      onChange={(checked) => set(item.key, checked)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
