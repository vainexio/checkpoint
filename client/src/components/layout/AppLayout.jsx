import { Link, NavLink, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { motion, useMotionValue, useReducedMotion } from 'framer-motion';
import { Street, useStreetGeometry, useWheelSpin } from './Street.jsx';
import { BusStatusScene } from '@/components/BusStatusScene.jsx';
import { MapPin } from 'lucide-react';
import { cn } from '@/lib/utils.ts';
import { formatTime } from '@/utils/time.js';

/**
 * SCOUT's application shell, adopted wholesale: glass navbar, ambient blob
 * background, animated page transitions, and the PageHeader pattern.
 *
 * All three experiences share the one light palette. A passenger checking a bus
 * and a dispatcher checking the same bus should recognise it as the same
 * product, and a light board stays readable on a phone held up outdoors.
 */

export function BrandMark({ className = '' }) {
  return (
    <span
      className={cn(
        'grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-sm',
        className
      )}
      aria-hidden
    >
      <MapPin className="h-[18px] w-[18px]" strokeWidth={2.5} />
    </span>
  );
}

export function Navbar({ home = '/', links = [], right = null }) {
  return (
    <header className="sticky top-0 z-50 w-full glass-panel">
      <div className="container mx-auto flex h-[60px] max-w-7xl items-center gap-2 px-3 sm:h-[68px] sm:gap-6 sm:px-6">
        <Link to={home} className="group flex shrink-0 items-center gap-2.5">
          <BrandMark />
          {/*
            * The wordmark is the first thing to go on a phone.
            *
            * At 375px it ate 150 of the 375 pixels and squeezed the nav until
            * "My trips" rendered as "My" and "Arrivals board" was clipped away
            * entirely — a conductor could not reach half the app. The mark alone
            * still says whose app this is, and it is a link home either way.
            */}
          <span className="hidden text-[15px] font-extrabold tracking-[0.16em] sm:inline">
            CHECKPOINT
          </span>
        </Link>

        <nav className="no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto sm:gap-1">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                cn(
                  'relative whitespace-nowrap px-1.5 py-4 text-[13px] font-semibold transition-colors hover:text-foreground sm:px-2 sm:text-[14px]',
                  isActive ? 'text-foreground' : 'text-muted-foreground'
                )
              }
            >
              {({ isActive }) => (
                <>
                  {link.label}
                  {isActive && (
                    <motion.div
                      layoutId="navbar-active-pill"
                      className="absolute -bottom-px left-0 right-0 h-[3px] rounded-t-full bg-primary"
                      initial={false}
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {right && <div className="flex shrink-0 items-center gap-2 sm:gap-3">{right}</div>}
      </div>
    </header>
  );
}

export function AppLayout({ children, navbar }) {
  const location = useLocation();

  return (
    <div className="relative flex min-h-[100dvh] flex-col bg-background text-foreground selection:bg-primary/20">
      {navbar}

      <main className="relative z-10 mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6">
        {/*
          * No AnimatePresence around the route.
          *
          * It was tracking an element it never needed to. With `mode="wait"`
          * an interrupted exit — which is exactly what the back button
          * causes — left nothing on screen at all; without it, the outgoing
          * route stayed mounted beside the incoming one and the page came
          * back doubled. Both are the same mistake: presence tracking only
          * earns its keep when something has to animate *out*, and nothing
          * here does.
          *
          * Changing the key is enough. React unmounts the old route and
          * mounts the new one, and the new one plays its own entrance. One
          * route on screen, always.
          */}
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="h-full w-full"
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}

/* Never tie the drive to a span so short that a nudge throws the bus off. */
const MIN_DRIVE_SPAN = 260;

/**
 * Drives the header bus as the page scrolls.
 *
 * Scrolling down always drives it forward, out to the right, and it stops once
 * it is gone. Scrolling up depends on where it is: while some of it is still
 * in the frame it backs up to the kerb, which is the only reversal worth
 * having. Once it has cleared the frame there is nothing to reverse, so
 * scrolling up hands over to the next bus, which comes round from the left
 * nose first and parks rather than driving on through.
 *
 * The hand-off is a jump from off-screen right to off-screen left, and it
 * stays invisible for a specific reason: both ends of it sit outside the clip,
 * so the bus is never seen crossing back.
 */
function useBusDrive(sceneRef, busRef, parked) {
  const x = useMotionValue(0);
  const stillness = useReducedMotion();
  const still = parked || stillness;
  const lastY = useRef(0);
  const geo = useStreetGeometry(sceneRef, busRef);
  const spin = useWheelSpin(x, geo.wheel);

  useEffect(() => {
    if (still) return undefined;
    lastY.current = window.scrollY;

    // Gone at about the moment the header itself clears the top of the window,
    // which depends on how many lines the description wrapped to.
    const rate = geo.exit / Math.max(MIN_DRIVE_SPAN, geo.span);

    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastY.current;
      lastY.current = y;
      if (!delta) return;

      let at = x.get();

      if (delta > 0) {
        at = Math.min(geo.exit, at + delta * rate);
      } else {
        // Already gone: hand over to a fresh bus waiting off to the left.
        if (at >= geo.exit) at = -geo.enter;
        at =
          at < 0
            ? Math.min(0, at - delta * rate) // arriving, parks at the kerb
            : Math.max(0, at + delta * rate); // still in frame, backs up
      }

      x.set(at);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [geo, still, x]);

  return { x, spin, still };
}

/**
 * @param still  Park the bus. A page whose whole point is one trip's detail
 *               has nothing to gain from scenery that moves under the reader.
 * @param bare   Drop the street entirely and keep just the heading. The staff
 *               side is a working tool, not a shopfront; the scenery belongs
 *               where passengers are.
 * @param scene  Draw this trip's status instead of the street, in the same
 *               card shape the arrivals board uses — so a bus looks the same
 *               opening its doors whether you met it in a list or on its own
 *               page.
 */
export function PageHeader({ title, description, actions, icon: Icon, still, bare, scene }) {
  const sceneRef = useRef(null);
  const busRef = useRef(null);
  const drive = useBusDrive(sceneRef, busRef, still || bare);

  if (scene) {
    return (
      <div className="mb-5 overflow-hidden rounded-xl border bg-card shadow-sm sm:mb-7">
        <BusStatusScene scene={scene} />
        <div className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-end sm:gap-6 sm:p-5">
          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            {Icon && (
              <div className="mt-[3px] flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary sm:h-12 sm:w-12">
                <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-[21px] font-black leading-tight tracking-tight sm:text-[27px]">
                {title}
              </h1>
              {description && (
                <div className="mt-1 max-w-2xl text-[14px] font-medium text-muted-foreground sm:text-[15px]">
                  {description}
                </div>
              )}
            </div>
          </div>
          {actions && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 text-foreground/75 sm:gap-3">
              {actions}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (bare) {
    return (
      <div className="mb-5 flex flex-col justify-between gap-3 sm:mb-7 sm:flex-row sm:items-end sm:gap-6">
        <div className="flex min-w-0 items-start gap-3 sm:gap-4">
          {Icon && (
            <div className="mt-[3px] flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary sm:h-12 sm:w-12">
              <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-[22px] font-black leading-tight tracking-tight sm:text-[28px]">
              {title}
            </h1>
            {description && (
              <div className="mt-1 max-w-2xl text-[14px] font-medium text-muted-foreground sm:text-[15px]">
                {description}
              </div>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 text-foreground/75 sm:gap-3">
            {actions}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mb-5 sm:mb-7">
      <Street sceneRef={sceneRef} busRef={busRef} {...drive}>
        {/*
          * The flank carries the name, the line under it, and the controls.
          * Laid out in bands rather than overlays: the icon and the words in
          * one column, the actions in another, so nothing can land on top of
          * the text the way it used to.
          */}
        <div className="flex flex-col gap-3 px-4 pb-6 pt-4 sm:gap-4 sm:px-5 sm:pb-7 sm:pt-[18px] md:flex-row md:items-end md:justify-between md:gap-6">
          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            {Icon && (
              <div className="mt-[3px] flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-foreground/20 sm:h-11 sm:w-11">
                <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-[21px] font-black leading-tight tracking-tight sm:text-[27px]">
                {title}
              </h1>
              {description && (
                <div className="mt-1.5 max-w-2xl text-[13.5px] font-medium leading-relaxed text-primary-foreground sm:text-[14.5px]">
                  {description}
                </div>
              )}
            </div>
          </div>

          {actions && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:gap-3">{actions}</div>
          )}
        </div>
      </Street>
    </div>
  );
}

export function LiveIndicator({ lastUpdated }) {
  return (
    <span className="flex items-center gap-2 text-xs font-medium">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
      </span>
      {lastUpdated ? `Updated ${formatTime(lastUpdated)}` : 'Connecting…'}
    </span>
  );
}
