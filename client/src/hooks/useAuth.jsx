import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  changePassword as apiChangePassword,
  createFirstAdmin,
  fetchMe,
  fetchSetupStatus,
  login as apiLogin,
  logout as apiLogout,
  resetPassword as apiResetPassword,
} from '@/api/authApi.js';
import { getToken } from '@/api/client.js';

/**
 * One staff session, shared by the whole app.
 *
 * Admins and conductors sign in through the same form; what differs afterwards
 * is which product they are sent to, and that is decided by the role on their
 * account rather than by which page they happened to open.
 */
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  // null until known; { needsSetup, requiresToken } once asked.
  const [setup, setSetup] = useState(null);

  // Asked once, so a fresh deployment can offer setup instead of a login form
  // for an account that does not exist.
  useEffect(() => {
    let cancelled = false;
    fetchSetupStatus()
      .then((s) => !cancelled && setSetup(s))
      .catch(() => !cancelled && setSetup({ needsSetup: false, requiresToken: false }));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!getToken()) {
      setChecking(false);
      return () => {
        cancelled = true;
      };
    }

    fetchMe()
      .then((res) => !cancelled && setUser(res.user))
      .catch(() => !cancelled && setUser(null))
      .finally(() => !cancelled && setChecking(false));

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username, password) => {
    const signedIn = await apiLogin(username, password);
    setUser(signedIn);
    return signedIn;
  }, []);

  const completeSetup = useCallback(async (body) => {
    const created = await createFirstAdmin(body);
    setUser(created);
    setSetup({ needsSetup: false, requiresToken: false });
    return created;
  }, []);

  const logout = useCallback(() => {
    apiLogout();
    setUser(null);
  }, []);

  const changePassword = useCallback(async (current, next) => {
    const updated = await apiChangePassword(current, next);
    setUser(updated);
    return updated;
  }, []);

  const resetPassword = useCallback(async (body) => {
    const signedIn = await apiResetPassword(body);
    setUser(signedIn);
    return signedIn;
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, checking, setup, login, logout, completeSetup, changePassword, resetPassword }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an AuthProvider.');
  return ctx;
}

/**
 * Where an account belongs once it is signed in. An account still on a
 * temporary password belongs at the form that replaces it — the server will
 * not open anything else to it anyway.
 */
export const homeFor = (user) =>
  user?.mustChangePassword ? '/account/password' : user?.role === 'admin' ? '/admin' : '/conductor';
