import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  onChange?: (value: string) => void;
}

export function TextField({
  label,
  hint,
  error,
  onChange,
  className,
  id,
  ...rest
}: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="tn-field">
      {label && (
        <label className="tn-field__label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={[
          'tn-input',
          error ? 'tn-input--invalid' : '',
          className ?? '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-invalid={error ? true : undefined}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        {...rest}
      />
      {error ? (
        <span className="tn-field__error">{error}</span>
      ) : hint ? (
        <span className="tn-field__hint">{hint}</span>
      ) : null}
    </div>
  );
}
