import { useState } from 'react';
import { Wordmark } from './Masthead.jsx';
import './signin.css';

/**
 * Shared sign-in shell for the two authenticated products. The form is the
 * same; the copy and the destination are not.
 */
export function SignInForm({ title, subtitle, onLogin, home, footer }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onLogin(username, password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <div className="signin__card">
        <Wordmark to={home} />
        <h1 className="signin__title">{title}</h1>
        <p className="signin__sub">{subtitle}</p>

        <form onSubmit={submit}>
          {error && (
            <div className="notice notice--error" style={{ marginBottom: 16 }}>
              {error}
            </div>
          )}

          <label className="field">
            <span className="field__label">Username</span>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoFocus
              required
            />
          </label>

          <label className="field">
            <span className="field__label">Password</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {footer && <p className="signin__foot">{footer}</p>}
      </div>
    </div>
  );
}
