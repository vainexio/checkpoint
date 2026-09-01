import { Navigate, Route, Routes } from 'react-router-dom';
import { LogOut } from 'lucide-react';

import { AppLayout, Navbar } from '@/components/layout/AppLayout.jsx';
import { Button } from '@/components/ui/button.tsx';
import { useAuth } from '@/hooks/useAuth.js';

import StationsPage from '@/pages/guest/StationsPage.jsx';
import StationBoardPage from '@/pages/guest/StationBoardPage.jsx';
import TripDetailPage from '@/pages/guest/TripDetailPage.jsx';

import ConductorLoginPage from '@/pages/conductor/ConductorLoginPage.jsx';
import ConductorTripsPage from '@/pages/conductor/ConductorTripsPage.jsx';
import ConductorTripPage from '@/pages/conductor/ConductorTripPage.jsx';

import AdminLoginPage from '@/pages/admin/AdminLoginPage.jsx';
import AdminDashboardPage from '@/pages/admin/AdminDashboardPage.jsx';
import AdminTripsPage from '@/pages/admin/AdminTripsPage.jsx';
import AdminRoutesPage from '@/pages/admin/AdminRoutesPage.jsx';
import AdminCheckpointsPage from '@/pages/admin/AdminCheckpointsPage.jsx';
import AdminFleetPage from '@/pages/admin/AdminFleetPage.jsx';

/**
 * Three experiences, not three permission levels.
 *
 * The guest board runs in the dark palette because it is a display surface; the
 * conductor and admin apps are separate light-themed products with their own
 * sessions — neither can reach the other, and signing out of one leaves the
 * other alone.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/*" element={<GuestApp />} />
      <Route path="/conductor/*" element={<ConductorApp />} />
      <Route path="/admin/*" element={<AdminApp />} />
    </Routes>
  );
}

const SignOutButton = ({ onClick }) => (
  <Button variant="ghost" size="sm" onClick={onClick}>
    <LogOut className="mr-1.5 h-3.5 w-3.5" />
    Sign out
  </Button>
);

/* ------------------------------------------------------------------- guest */

function GuestApp() {
  return (
    <AppLayout
      dark
      navbar={
        <Navbar
          home="/"
          links={[
            { to: '/', label: 'Arrivals', end: true },
            { to: '/conductor', label: 'Conductor' },
            { to: '/admin', label: 'Operations' },
          ]}
        />
      }
    >
      <Routes>
        <Route index element={<StationsPage />} />
        <Route path="stations/:stationId" element={<StationBoardPage />} />
        <Route path="trips/:tripId" element={<TripDetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppLayout>
  );
}

/* --------------------------------------------------------------- conductor */

function ConductorApp() {
  const { user, checking, login, logout } = useAuth('conductor');

  if (checking) return <div className="min-h-[100dvh] bg-background" />;
  if (!user) return <ConductorLoginPage onLogin={login} />;

  return (
    <AppLayout
      navbar={
        <Navbar
          home="/conductor"
          links={[{ to: '/conductor', label: 'My trips', end: true }]}
          right={<SignOutButton onClick={logout} />}
        />
      }
    >
      <Routes>
        <Route index element={<ConductorTripsPage user={user} />} />
        <Route path="trips/:tripId" element={<ConductorTripPage />} />
        <Route path="*" element={<Navigate to="/conductor" replace />} />
      </Routes>
    </AppLayout>
  );
}

/* ------------------------------------------------------------------- admin */

function AdminApp() {
  const { user, checking, login, logout } = useAuth('admin');

  if (checking) return <div className="min-h-[100dvh] bg-background" />;
  if (!user) return <AdminLoginPage onLogin={login} />;

  return (
    <AppLayout
      navbar={
        <Navbar
          home="/admin"
          links={[
            { to: '/admin', label: 'Dashboard', end: true },
            { to: '/admin/trips', label: 'Trips' },
            { to: '/admin/routes', label: 'Routes' },
            { to: '/admin/checkpoints', label: 'Checkpoints' },
            { to: '/admin/fleet', label: 'Fleet' },
          ]}
          right={<SignOutButton onClick={logout} />}
        />
      }
    >
      <Routes>
        <Route index element={<AdminDashboardPage />} />
        <Route path="trips" element={<AdminTripsPage />} />
        <Route path="routes" element={<AdminRoutesPage />} />
        <Route path="checkpoints" element={<AdminCheckpointsPage />} />
        <Route path="fleet" element={<AdminFleetPage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </AppLayout>
  );
}
