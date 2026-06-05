import { useId, type ReactNode, type SelectHTMLAttributes } from 'react';

export interface SelectOption {
  value: string;
  label: ReactNode;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  options: SelectOption[];
  placeholder?: string;
  onChange?: (value: string) => void;
}

export function Select({
  label,
  hint,
  error,
  options,
  placeholder,
  onChange,
  className,
  id,
  ...rest
}: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className="tn-field">
      {label && (
        <label className="tn-field__label" htmlFor={selectId}>
          {label}
        </label>
      )}
      <select
        id={selectId}
        className={['tn-select', className ?? ''].filter(Boolean).join(' ')}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        {...rest}
      >
        {placeholder !== undefined && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? (
        <span className="tn-field__error">{error}</span>
      ) : hint ? (
        <span className="tn-field__hint">{hint}</span>
      ) : null}
    </div>
  );
}
