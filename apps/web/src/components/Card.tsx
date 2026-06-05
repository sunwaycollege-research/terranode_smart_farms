import type { ReactNode } from 'react';

export interface CardProps {
  title?: ReactNode;
  actions?: ReactNode;
  /** Remove body padding (e.g. when embedding a table). */
  flush?: boolean;
  className?: string;
  children?: ReactNode;
}

export function Card({ title, actions, flush, className, children }: CardProps) {
  return (
    <section className={['tn-card', className ?? ''].filter(Boolean).join(' ')}>
      {(title || actions) && (
        <header className="tn-card__head">
          {title ? <h3 className="tn-card__title">{title}</h3> : <span />}
          {actions && <div className="tn-row">{actions}</div>}
        </header>
      )}
      <div className={`tn-card__body${flush ? ' tn-card__body--flush' : ''}`}>
        {children}
      </div>
    </section>
  );
}
