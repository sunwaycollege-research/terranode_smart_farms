import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const classes = [
    'tn-btn',
    `tn-btn--${variant}`,
    size === 'sm' ? 'tn-btn--sm' : '',
    block ? 'tn-btn--block' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const onAccent = variant === 'primary' || variant === 'danger';

  return (
    <button
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span
          className={`tn-spinner${onAccent ? ' tn-spinner--on-primary' : ''}`}
          aria-hidden
        />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}
