import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
} from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { AdminLayout } from './layouts/AdminLayout';
import LoginPage from './pages/login';
import CustomersPage from './pages/customers';
import FleetPage from './pages/fleet';
import CropsPage from './pages/crops';
import AuditPage from './pages/audit';
import AnalyticsPage from './pages/analytics';

function NotFound() {
  return (
    <div className="tn-center">
      <div style={{ textAlign: 'center' }}>
        <div className="display" style={{ fontSize: 48 }}>
          404
        </div>
        <a href="/customers">Back to console</a>
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AdminLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/customers" replace /> },
      { path: 'customers/*', element: <CustomersPage /> },
      { path: 'fleet/*', element: <FleetPage /> },
      { path: 'crops/*', element: <CropsPage /> },
      { path: 'analytics/*', element: <AnalyticsPage /> },
      { path: 'audit/*', element: <AuditPage /> },
    ],
  },
  { path: '*', element: <NotFound /> },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
