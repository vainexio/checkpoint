import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LogOut } from 'lucide-react';

import { AppLayout, Navbar } from '@/components/layout/AppLayout.jsx';
import { Button } from '@/components/ui/button.tsx';
import { AuthProvider, homeFor, useAuth } from '@/hooks/useAuth.jsx';

import LoginPage from '@/pages/LoginPage.jsx';

import StationsPage from '@/pages/guest/StationsPage.jsx';
import StationBoardPage from '@/pages/guest/StationBoardPage.jsx';
import TripDetailPage from '@/pages/guest/TripDetailPage.jsx';

import ConductorTripsPage from '@/pages/conductor/ConductorTripsPage.jsx';
import ConductorTripPage from '@/pages/conductor/ConductorTripPage.jsx';

import AdminDashboardPage from '@/pages/admin/AdminDashboardPage.jsx';
import AdminTripsPage from '@/pages/admin/AdminTripsPage.jsx';
import AdminRoutesPage from '@/pages/admin/AdminRoutesPage.jsx';
import AdminFleetPage from '@/pages/admin/AdminFleetPage.jsx';

/**
 * Three experiences behind one sign-in.
 *
 * Guests need no account at all. Conductors and admins share a single login
 * form; their role decides which product they land in, and `RequireRole` keeps
 * each out of the other's.
 */
export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/conductor/*" element={<ConductorApp />} />
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="/*" element={<GuestApp />} />
      </Routes>
    </AuthProvider>
  );
}

/** Send anyone without the right role somewhere they can actually go. */
function RequireRole({ role, children }) {
  const { user, checking } = useAuth();
  const location = useLocation();

  if (checking) return <div className="min-h-[100dvh] bg-background" />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (user.role !== role) return <Navigate to={homeFor(user)} replace />;

  return children;
}

function SignOutButton() {
  const { logout } = useAuth();
  return (
    <Button variant="ghost" size="sm" onClick={logout}>
      <LogOut className="mr-1.5 h-3.5 w-3.5" />
      Sign out
    </Button>
  );
}

/* ------------------------------------------------------------------- guest */

function GuestApp() {
  const { user } = useAuth();

  return (
    <AppLayout
      navbar={
        <Navbar
          home="/"
          links={[{ to: '/', label: 'Arrivals', end: true }]}
          right={
            <Button variant="outline" size="sm" asChild>
              <a href={user ? homeFor(user) : '/login'}>{user ? 'Staff area' : 'Staff sign-in'}</a>
            </Button>
          }
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
  const { user } = useAuth();

  return (
    <RequireRole role="conductor">
      <AppLayout
        navbar={
          <Navbar
            home="/conductor"
            links={[
              { to: '/conductor', label: 'My trips', end: true },
              { to: '/', label: 'Arrivals board' },
            ]}
            right={<SignOutButton />}
          />
        }
      >
        <Routes>
          <Route index element={<ConductorTripsPage user={user} />} />
          <Route path="trips/:tripId" element={<ConductorTripPage />} />
          <Route path="*" element={<Navigate to="/conductor" replace />} />
        </Routes>
      </AppLayout>
    </RequireRole>
  );
}

/* ------------------------------------------------------------------- admin */

function AdminApp() {
  return (
    <RequireRole role="admin">
      <AppLayout
        navbar={
          <Navbar
            home="/admin"
            links={[
              { to: '/admin', label: 'Dashboard', end: true },
              { to: '/admin/trips', label: 'Trips' },
              { to: '/admin/routes', label: 'Routes & checkpoints' },
              { to: '/admin/fleet', label: 'Fleet' },
            ]}
            right={<SignOutButton />}
          />
        }
      >
        <Routes>
          <Route index element={<AdminDashboardPage />} />
          <Route path="trips" element={<AdminTripsPage />} />
          <Route path="routes" element={<AdminRoutesPage />} />
          <Route path="fleet" element={<AdminFleetPage />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </AppLayout>
    </RequireRole>
  );
}
