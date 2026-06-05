import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { Button } from './Button';

interface NavItem {
  to: string;
  labelKey: string;
  icon: string;
}

const SECTIONS: { titleKey: string; items: NavItem[] }[] = [
  {
    titleKey: 'nav.management',
    items: [
      { to: '/customers', labelKey: 'nav.customers', icon: '👤' },
      { to: '/fleet', labelKey: 'nav.fleet', icon: '📡' },
      { to: '/crops', labelKey: 'nav.crops', icon: '🌱' },
    ],
  },
  {
    titleKey: 'nav.platform',
    items: [
      { to: '/analytics', labelKey: 'nav.analytics', icon: '📊' },
      { to: '/audit', labelKey: 'nav.audit', icon: '📜' },
    ],
  },
];

export function NavSidebar() {
  const { t } = useTranslation();
  const { user, account, logout } = useAuth();
  const initials = (user?.name ?? 'A')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <aside className="tn-sidebar">
      <div className="tn-sidebar__brand">
        <div className="tn-sidebar__logo">🌱</div>
        <div>
          <div className="tn-sidebar__wordmark">{t('app.name')}</div>
          <div className="tn-sidebar__tag">{t('app.tagline')}</div>
        </div>
      </div>

      <nav className="tn-nav">
        {SECTIONS.map((section) => (
          <div key={section.titleKey}>
            <div className="tn-nav__section">{t(section.titleKey)}</div>
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `tn-nav__link${isActive ? ' is-active' : ''}`
                }
              >
                <span className="tn-nav__icon" aria-hidden>
                  {item.icon}
                </span>
                {t(item.labelKey)}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="tn-sidebar__foot">
        <div className="tn-user">
          <div className="tn-user__avatar">{initials}</div>
          <div style={{ minWidth: 0 }}>
            <div className="tn-user__name">{user?.name ?? 'Admin'}</div>
            <div className="tn-user__email">{account?.name ?? user?.email}</div>
          </div>
        </div>
        <Button variant="secondary" size="sm" block onClick={() => void logout()}>
          {t('common.logout')}
        </Button>
      </div>
    </aside>
  );
}
