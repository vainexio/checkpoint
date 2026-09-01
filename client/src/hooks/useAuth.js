import { useCallback, useEffect, useState } from 'react';
import { fetchMe, login as apiLogin, logout as apiLogout } from '../api/authApi.js';
import { getToken } from '../api/client.js';

/**
 * A session for one role. Admin and conductor sessions are independent: signing
 * out of one leaves the other alone, because they are separate products.
 */
export function useAuth(role) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (!getToken(role)) {
      setChecking(false);
      return () => {
        cancelled = true;
      };
    }

    fetchMe(role)
      .then((res) => {
        if (cancelled) return;
        // A token for the wrong role is no session at all here.
        setUser(res.user.role === role ? res.user : null);
      })
      .catch(() => !cancelled && setUser(null))
      .finally(() => !cancelled && setChecking(false));

    return () => {
      cancelled = true;
    };
  }, [role]);

  const login = useCallback(
    async (username, password) => {
      const signedIn = await apiLogin(role, username, password);
      setUser(signedIn);
      return signedIn;
    },
    [role]
  );

  const logout = useCallback(() => {
    apiLogout(role);
    setUser(null);
  }, [role]);

  return { user, checking, login, logout };
}
