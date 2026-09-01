import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { BrandMark } from '@/components/layout/AppLayout.jsx';

/**
 * Shared sign-in shell for the two authenticated products. The form is the
 * same; the copy and the destination are not.
 */
export function SignInForm({ title, subtitle, onLogin, home, footer, icon: Icon }) {
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
            <Link to={home} className="mb-2 flex items-center gap-2.5">
              <BrandMark />
              <span className="text-[15px] font-extrabold tracking-[0.16em]">CHECKPOINT</span>
            </Link>
            <CardTitle className="flex items-center gap-2 text-2xl font-black tracking-tight">
              {Icon && <Icon className="h-5 w-5 text-primary" />}
              {title}
            </CardTitle>
            <CardDescription>{subtitle}</CardDescription>
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

            {footer && (
              <p className="mt-6 border-t border-border pt-4 text-[13px] text-muted-foreground">
                {footer}
              </p>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
