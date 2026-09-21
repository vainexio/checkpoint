import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowLeft, KeyRound, LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { BrandMark } from '@/components/layout/AppLayout.jsx';
import { homeFor, useAuth } from '@/hooks/useAuth.jsx';

/**
 * The two ways a staff password changes hands: choosing your own after an admin
 * set a temporary one, and getting back in with a one-time code when you have
 * forgotten it. Both end with the person signed in on a password only they know.
 */

function AccountCard({ icon: Icon, title, description, children, footer }) {
  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-[420px]"
      >
        <Card>
          <CardHeader>
            <Link to="/" className="mb-2 flex items-center gap-2.5">
              <BrandMark />
              <span className="text-[15px] font-extrabold tracking-[0.16em]">CHECKPOINT</span>
            </Link>
            <CardTitle className="flex items-center gap-2 text-2xl font-black tracking-tight">
              <Icon className="h-5 w-5 text-primary" />
              {title}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>
            {children}
            {footer && (
              <div className="mt-6 border-t border-border pt-4 text-[13px] text-muted-foreground">
                {footer}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

function Field({ id, label, hint, ...props }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...props} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ErrorNote({ message }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/** Checked in the browser too, so a typo is caught before a round trip. */
function mismatch(next, confirm) {
  if (next.length < 8) return 'Password must be at least 8 characters.';
  if (next !== confirm) return 'The two new passwords do not match.';
  return null;
}

/**
 * Change your own password — required on first sign-in for an account an
 * admin created, and available any time after from the navigation bar.
 */
export function ChangePasswordPage() {
  const { user, checking, changePassword } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (checking) return <div className="min-h-[100dvh] bg-background" />;
  if (!user) return <Navigate to="/login" replace />;

  const forced = user.mustChangePassword;

  const submit = async (e) => {
    e.preventDefault();
    const problem = mismatch(form.next, form.confirm);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const updated = await changePassword(form.current, form.next);
      navigate(homeFor(updated), { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <AccountCard
      icon={KeyRound}
      title={forced ? 'Choose your own password' : 'Change password'}
      description={
        forced
          ? `Welcome, ${user.name}. The password you were given was set by an admin, so it has to be replaced before you continue.`
          : `Signed in as ${user.username}. Any other device signed in to this account will be signed out.`
      }
      footer={
        forced ? (
          <>Only you will know the new one. If you forget it, an admin can give you a reset code.</>
        ) : (
          <Link
            to={homeFor(user)}
            className="inline-flex items-center gap-1.5 font-semibold text-primary underline-offset-4 hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back without changing it
          </Link>
        )
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote message={error} />
        <input type="hidden" autoComplete="username" value={user.username} readOnly />
        <Field
          id="pw-current"
          label={forced ? 'Password you were given' : 'Current password'}
          type="password"
          autoComplete="current-password"
          value={form.current}
          onChange={(e) => setForm({ ...form, current: e.target.value })}
          autoFocus
          required
        />
        <Field
          id="pw-new"
          label="New password"
          hint="At least 8 characters, and not your username."
          type="password"
          autoComplete="new-password"
          value={form.next}
          onChange={(e) => setForm({ ...form, next: e.target.value })}
          minLength={8}
          required
        />
        <Field
          id="pw-confirm"
          label="New password again"
          type="password"
          autoComplete="new-password"
          value={form.confirm}
          onChange={(e) => setForm({ ...form, confirm: e.target.value })}
          required
        />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Saving…' : forced ? 'Save and continue' : 'Change password'}
        </Button>
      </form>
    </AccountCard>
  );
}

/**
 * Forgotten password. There is no email here to send a link to, so an admin
 * issues a one-time code — in person or over the phone — and the staff member
 * chooses a new password with it. The admin never learns what they chose.
 */
export function ResetPasswordPage() {
  const { resetPassword } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', code: '', next: '', confirm: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const problem = mismatch(form.next, form.confirm);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const user = await resetPassword({
        username: form.username,
        code: form.code,
        newPassword: form.next,
      });
      navigate(homeFor(user), { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <AccountCard
      icon={LifeBuoy}
      title="Reset your password"
      description="Ask an admin for a reset code. It works once and expires after 30 minutes."
      footer={
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 font-semibold text-primary underline-offset-4 hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <ErrorNote message={error} />
        <Field
          id="rs-user"
          label="Username"
          autoComplete="username"
          autoCapitalize="none"
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
          autoFocus
          required
        />
        <Field
          id="rs-code"
          label="Reset code"
          hint="Eight letters and numbers, like K7QM-2XPA."
          autoComplete="one-time-code"
          autoCapitalize="characters"
          className="font-mono uppercase tracking-[0.2em]"
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
          required
        />
        <Field
          id="rs-new"
          label="New password"
          hint="At least 8 characters, and not your username."
          type="password"
          autoComplete="new-password"
          value={form.next}
          onChange={(e) => setForm({ ...form, next: e.target.value })}
          minLength={8}
          required
        />
        <Field
          id="rs-confirm"
          label="New password again"
          type="password"
          autoComplete="new-password"
          value={form.confirm}
          onChange={(e) => setForm({ ...form, confirm: e.target.value })}
          required
        />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Saving…' : 'Set password and sign in'}
        </Button>
      </form>
    </AccountCard>
  );
}
