import type { ReactNode } from 'react';

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  hint?: ReactNode;
}

/** A single KPI tile — monospace value, uppercase label, optional unit/hint. */
export function Stat({ label, value, unit, hint }: StatProps) {
  return (
    <div className="tn-stat">
      <span className="tn-stat__label">{label}</span>
      <span className="tn-stat__value">
        {value}
        {unit ? <span className="tn-stat__unit"> {unit}</span> : null}
      </span>
      {hint ? <span className="tn-stat__hint">{hint}</span> : null}
    </div>
  );
}
