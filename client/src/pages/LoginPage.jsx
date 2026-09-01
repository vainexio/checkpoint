import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { BrandMark } from '@/components/layout/AppLayout.jsx';
import { homeFor, useAuth } from '@/hooks/useAuth.jsx';

/**
 * The single staff sign-in.
 *
 * Admins and conductors use the same form. Where someone lands is decided by
 * their account, not by which of two pages they guessed at — and if they were
 * bounced here from a page they were trying to reach, they go back to it.
 */
export default function LoginPage() {
  const { user, login } = useAuth();
  const location = useLocation();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user) {
    return <Navigate to={location.state?.from ?? homeFor(user)} replace />;
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
      <div className="pointer-events-none fixed inset-0 bg-blobs" aria-hidden />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-[400px]"
      >
        <Card>
          <CardHeader>
            <Link to="/" className="mb-2 flex items-center gap-2.5">
              <BrandMark />
              <span className="text-[15px] font-extrabold tracking-[0.16em]">CHECKPOINT</span>
            </Link>
            <CardTitle className="text-2xl font-black tracking-tight">Staff sign-in</CardTitle>
            <CardDescription>
              For conductors and operations staff. We'll take you to the right place.
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
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  autoFocus
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>

              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>

            <p className="mt-6 border-t border-border pt-4 text-[13px] text-muted-foreground">
              <Link
                to="/"
                className="inline-flex items-center gap-1.5 font-semibold text-primary underline-offset-4 hover:underline"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Just checking on a bus?
              </Link>{' '}
              The arrivals board needs no account.
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
