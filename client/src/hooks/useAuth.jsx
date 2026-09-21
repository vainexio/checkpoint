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
import { ApiError, getToken } from '@/api/client.js';
import { clearSnapshots } from '@/utils/snapshot.js';

/**
 * Who was signed in, remembered on the device.
 *
 * Only for one case: opening the app with no signal. The session token is
 * still valid, but the server cannot be asked who it belongs to, and treating
 * "cannot reach the server" as "signed out" sent a conductor on a bus with no
 * signal to a login form they could not use. Anything the server actually
 * answers — including a refusal — still wins.
 */
const USER_KEY = 'checkpoint.user';

const rememberUser = (user) => {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* private browsing: nothing is remembered, which is merely less helpful */
  }
};

const rememberedUser = () => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null');
  } catch {
    return null;
  }
};

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
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError) {
          // The server answered and said no: the session really is over.
          rememberUser(null);
          setUser(null);
        } else {
          // No answer at all. Carry on as the person this token belongs to;
          // the first request that does get through will settle it.
          setUser(rememberedUser());
        }
      })
      .finally(() => !cancelled && setChecking(false));

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (user) rememberUser(user);
  }, [user]);

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
    rememberUser(null);
    // Trip snapshots belong to the person who signed out, not the next one.
    clearSnapshots();
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
