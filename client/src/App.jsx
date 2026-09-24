import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  Bus,
  ClipboardList,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MapPin,
  Route as RouteIcon,
  Users,
} from 'lucide-react';

import { AppLayout } from '@/components/layout/AppLayout.jsx';
import { Button } from '@/components/ui/button.tsx';
import { AuthProvider, homeFor, useAuth } from '@/hooks/useAuth.jsx';

import LoginPage from '@/pages/LoginPage.jsx';
import SetupPage from '@/pages/SetupPage.jsx';
import { ChangePasswordPage, ResetPasswordPage } from '@/pages/AccountPages.jsx';

import StationsPage from '@/pages/guest/StationsPage.jsx';
import StationBoardPage from '@/pages/guest/StationBoardPage.jsx';
import StationDisplayPage from '@/pages/guest/StationDisplayPage.jsx';
import TripDetailPage from '@/pages/guest/TripDetailPage.jsx';

import ConductorTripsPage from '@/pages/conductor/ConductorTripsPage.jsx';
import ConductorTripPage from '@/pages/conductor/ConductorTripPage.jsx';

import AdminDashboardPage from '@/pages/admin/AdminDashboardPage.jsx';
import AdminTripsPage from '@/pages/admin/AdminTripsPage.jsx';
import AdminTripDetailPage from '@/pages/admin/AdminTripDetailPage.jsx';
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
        <Route path="/setup" element={<SetupRoute />} />
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/account/password" element={<ChangePasswordPage />} />
        {/* Full-screen terminal board: no chrome, no navigation, no input. */}
        <Route path="/display/:stationId" element={<StationDisplayPage />} />
        <Route path="/conductor/*" element={<ConductorApp />} />
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="/*" element={<GuestApp />} />
      </Routes>
    </AuthProvider>
  );
}

function SetupRoute() {
  const { setup, completeSetup } = useAuth();
  if (!setup) return <div className="min-h-[100dvh] bg-background" />;
  return <SetupPage setup={setup} onDone={completeSetup} />;
}

/**
 * A system with no accounts has nobody to sign in as, so the login form sends
 * you to setup rather than asking for a password that cannot exist yet.
 */
function LoginRoute() {
  const { setup } = useAuth();
  if (!setup) return <div className="min-h-[100dvh] bg-background" />;
  if (setup.needsSetup) return <Navigate to="/setup" replace />;
  return <LoginPage />;
}

/** Send anyone without the right role somewhere they can actually go. */
function RequireRole({ role, children }) {
  const { user, checking, setup } = useAuth();
  if (setup?.needsSetup) return <Navigate to="/setup" replace />;
  const location = useLocation();

  if (checking) return <div className="min-h-[100dvh] bg-background" />;
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  if (user.mustChangePassword) return <Navigate to="/account/password" replace />;
  if (user.role !== role) return <Navigate to={homeFor(user)} replace />;

  return children;
}

function SignOutButton() {
  const { logout } = useAuth();
  return (
    <>
      <Button variant="ghost" size="sm" asChild>
        <Link to="/account/password" aria-label="Change password" title="Change password">
          <KeyRound className="h-3.5 w-3.5" />
        </Link>
      </Button>
      <Button variant="ghost" size="sm" onClick={logout} aria-label="Sign out">
        <LogOut className="h-3.5 w-3.5 sm:mr-1.5" />
        {/* The icon carries it on a phone; the word is what makes it unambiguous
            on a desktop where there is room for it. */}
        <span className="hidden sm:inline">Sign out</span>
      </Button>
    </>
  );
}

/* ------------------------------------------------------------------- guest */

function GuestApp() {
  const { user } = useAuth();

  return (
    <AppLayout
      home="/"
      links={[{ to: '/', label: 'Arrivals', icon: MapPin, end: true }]}
      right={
        <Button variant="outline" size="sm" asChild>
          <a href={user ? homeFor(user) : '/login'}>{user ? 'Staff area' : 'Staff sign-in'}</a>
        </Button>
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
        home="/conductor"
        links={[
          { to: '/conductor', label: 'My trips', icon: ClipboardList, end: true },
          { to: '/', label: 'Arrivals board', shortLabel: 'Arrivals', icon: Bus },
        ]}
        right={<SignOutButton />}
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
        home="/admin"
        links={[
          { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
          { to: '/admin/trips', label: 'Trips', icon: ClipboardList },
          {
            to: '/admin/routes',
            label: 'Routes & checkpoints',
            shortLabel: 'Routes',
            icon: RouteIcon,
          },
          { to: '/admin/fleet', label: 'Fleet', icon: Users },
        ]}
        right={<SignOutButton />}
      >
        <Routes>
          <Route index element={<AdminDashboardPage />} />
          <Route path="trips" element={<AdminTripsPage />} />
          <Route path="trips/:tripId" element={<AdminTripDetailPage />} />
          <Route path="routes" element={<AdminRoutesPage />} />
          <Route path="fleet" element={<AdminFleetPage />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </AppLayout>
    </RequireRole>
  );
}
