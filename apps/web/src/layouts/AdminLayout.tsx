import { Outlet } from 'react-router-dom';
import { LanguageSwitcher, NavSidebar } from '../components';

/** The protected admin shell: persistent left nav + top bar + routed content. */
export function AdminLayout() {
  return (
    <div className="tn-shell">
      <NavSidebar />
      <div className="tn-main">
        <header className="tn-topbar">
          <LanguageSwitcher />
        </header>
        <main className="tn-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
