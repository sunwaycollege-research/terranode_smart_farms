import type { InputHTMLAttributes } from 'react';

export interface SwitchProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}

/** Accessible on/off toggle (a.k.a. Toggle). */
export function Switch({ checked, onChange, label, disabled, ...rest }: SwitchProps) {
  return (
    <label className="tn-switch">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        {...rest}
      />
      <span className="tn-switch__track">
        <span className="tn-switch__thumb" />
      </span>
      {label && <span className="tn-switch__label">{label}</span>}
    </label>
  );
}

/** Alias matching the spec's "Toggle/Switch" naming. */
export const Toggle = Switch;
