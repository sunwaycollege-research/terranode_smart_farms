import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="tn-pageheader">
      <div>
        <h1 className="tn-pageheader__title">{title}</h1>
        {subtitle && <p className="tn-pageheader__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="tn-pageheader__actions">{actions}</div>}
    </header>
  );
}
