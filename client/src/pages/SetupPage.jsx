import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertCircle, ShieldPlus } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { BrandMark } from '@/components/layout/AppLayout.jsx';
import { useAuth } from '@/hooks/useAuth.jsx';

/**
 * First run: create the account that everything else hangs off.
 *
 * A brand-new deployment has nobody to sign in as, so a login form would be a
 * dead end. This page exists only while the system has no accounts at all —
 * once one exists the server refuses, and this becomes a redirect.
 */
export default function SetupPage({ setup, onDone }) {
  const { user } = useAuth();
  const [form, setForm] = useState({ name: '', username: '', password: '', token: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/admin" replace />;
  if (setup && !setup.needsSetup) return <Navigate to="/login" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onDone(form);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

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
              <ShieldPlus className="h-5 w-5 text-primary" />
              Set up this system
            </CardTitle>
            <CardDescription>
              There are no accounts yet. Create the first operations admin — you can add routes,
              buses and conductors from there.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="s-name">Your name</Label>
                <Input
                  id="s-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  autoFocus
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="s-user">Username</Label>
                <Input
                  id="s-user"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  autoCapitalize="none"
                  autoComplete="username"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="s-pass">Password (at least 8 characters)</Label>
                <Input
                  id="s-pass"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>

              {setup?.requiresToken && (
                <div className="space-y-2">
                  <Label htmlFor="s-token">Setup token</Label>
                  <Input
                    id="s-token"
                    value={form.token}
                    onChange={(e) => setForm({ ...form, token: e.target.value })}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    The SETUP_TOKEN set on the server, so that only you can claim this system.
                  </p>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Creating…' : 'Create admin and sign in'}
              </Button>
            </form>

            <p className="mt-6 border-t border-border pt-4 text-[13px] text-muted-foreground">
              This page closes as soon as an account exists. After that, new admins are created
              from inside the app.
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
