import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { animate, motion, useMotionValue, useReducedMotion } from 'framer-motion';
import { AlertCircle, ArrowLeft, Bus as BusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Street, useStreetGeometry, useWheelSpin } from '@/components/layout/Street.jsx';
import { homeFor, useAuth } from '@/hooks/useAuth.jsx';

/**
 * Brings the bus in when the page opens, and sends it out again on the way to
 * somewhere else.
 *
 * The departure is the reason this exists: signing in should feel like being
 * taken somewhere, so the redirect waits for the coach to actually leave
 * rather than cutting away mid-shot. `onDeparted` is what releases it, and it
 * fires whether the animation ran or was skipped — a page that never redirects
 * because someone prefers reduced motion would be a far worse bug than a
 * missing flourish.
 */
function useBusArrival(sceneRef, busRef, leaving, onDeparted) {
  const x = useMotionValue(0);
  const stillness = useReducedMotion();
  const geo = useStreetGeometry(sceneRef, busRef);
  const spin = useWheelSpin(x, geo.wheel);
  const parked = useRef(false);
  const departed = useRef(false);

  // Read through a ref so a later re-measure cannot restart either effect.
  // Both of these tear their animation down on cleanup, so re-running one
  // mid-flight stops the bus where it stands -- which is exactly what a
  // ResizeObserver firing after first paint used to do.
  const latest = useRef(geo);
  latest.current = geo;

  // Pull in from off-screen left, once, and only once the street has been
  // measured: starting at a guessed offset makes the bus jump when the real
  // number lands.
  useEffect(() => {
    if (leaving || parked.current) return undefined;

    if (stillness) {
      parked.current = true;
      x.set(0);
      return undefined;
    }
    if (!geo.ready) return undefined;

    parked.current = true;
    x.set(-latest.current.enter);
    const run = animate(x, 0, { duration: 1.15, ease: [0.16, 1, 0.3, 1] });
    return () => run.stop();
  }, [geo.ready, stillness, leaving, x]);

  useEffect(() => {
    if (!leaving || departed.current) return undefined;
    departed.current = true;

    if (stillness) {
      onDeparted();
      return undefined;
    }

    // Eases in rather than out: a bus pulling away is still gathering speed
    // when it leaves the frame.
    const run = animate(x, latest.current.exit, { duration: 0.85, ease: [0.4, 0, 0.9, 0.45] });
    run.then(onDeparted, () => {});

    // Signing in must never hang on a decoration. If the animation is stopped
    // or its promise never settles, this sends them on anyway.
    const failsafe = setTimeout(onDeparted, 1500);
    return () => {
      run.stop();
      clearTimeout(failsafe);
    };
  }, [leaving, stillness, onDeparted, x]);

  return { x, spin, still: false };
}

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
  const [leaving, setLeaving] = useState(false);
  const [departed, setDeparted] = useState(false);

  // Whether we arrived already signed in, captured before anything can change
  // it. Someone who is only passing through gets sent on immediately; the bus
  // is for people who actually sign in here.
  const passingThrough = useRef(Boolean(user));

  const sceneRef = useRef(null);
  const busRef = useRef(null);
  const onDeparted = useRef(() => setDeparted(true)).current;
  const drive = useBusArrival(sceneRef, busRef, leaving, onDeparted);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      // Correct credentials: the bus pulls out, and the redirect below waits
      // for it. `busy` stays set so the form cannot be submitted again.
      setLeaving(true);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (user && (passingThrough.current || departed)) {
    return <Navigate to={location.state?.from ?? homeFor(user)} replace />;
  }

  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center justify-center gap-7 bg-background px-4 py-10">
      <div className="w-full max-w-[1100px]">
        <Street sceneRef={sceneRef} busRef={busRef} {...drive}>
          <div className="flex items-center gap-3 px-4 pb-6 pt-4 sm:gap-4 sm:px-5 sm:pb-7 sm:pt-[18px]">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-foreground/20 sm:h-11 sm:w-11">
              <BusIcon className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-[19px] font-black tracking-[0.16em] sm:text-[24px]">CHECKPOINT</h1>
              <div className="mt-1 text-[13.5px] font-medium text-primary-foreground sm:text-[14.5px]">
                {leaving ? 'Signed in — off we go.' : 'Staff sign-in.'}
              </div>
            </div>
          </div>
        </Street>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-[400px]"
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl font-black tracking-tight">Sign in</CardTitle>
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
                {leaving ? 'Taking you there…' : busy ? 'Signing in…' : 'Sign in'}
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
