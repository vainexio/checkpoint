import { Link, NavLink, useLocation } from 'react-router-dom';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useReducedMotion } from 'framer-motion';
import { Street, useStreetGeometry, useWheelSpin } from './Street.jsx';
import { BusStatusScene } from '@/components/BusStatusScene.jsx';
import { MapPin } from 'lucide-react';
import { cn } from '@/lib/utils.ts';
import { formatTime } from '@/utils/time.js';
import { useAuth } from '@/hooks/useAuth.jsx';
import { reseedDemoData, reseedProgress } from '@/api/adminApi.js';

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

/**
 * Rebuilds the demo data on a double-click of the wordmark.
 *
 * Deliberately unlabelled: it is for the person running a demonstration, not
 * for the audience, and a visible "reset everything" button on a live board
 * invites exactly the click nobody wants. It is gated on an admin session on
 * the server, so for anyone else the wordmark is only ever a link home.
 *
 * The wordmark reports what happened in place of itself, because a demo that
 * silently did nothing is worse than one that says so.
 */
function useDemoReseed() {
  const { user } = useAuth();
  const [state, setState] = useState(null);

  const run = async (e) => {
    if (user?.role !== 'admin' || state === 'working') return;
    e.preventDefault();
    setState('working');

    try {
      await reseedDemoData();

      // Ask how it is going rather than holding a request open for the whole
      // rebuild. Two minutes of patience is far longer than it has ever taken.
      for (let i = 0; i < 60; i += 1) {
        await new Promise((r) => setTimeout(r, 2000));
        const progress = await reseedProgress();
        if (progress.running) continue;
        if (progress.error) throw new Error(progress.error);

        setState('done');
        // Straight into the fresh data rather than waiting on the next poll.
        setTimeout(() => window.location.reload(), 700);
        return;
      }
      throw new Error('Reseed did not finish in time.');
    } catch {
      setState('failed');
      setTimeout(() => setState(null), 2500);
    }
  };

  const label = state === 'working' ? 'RESEEDING' : state === 'done' ? 'FRESH DATA' : state === 'failed' ? 'RESEED FAILED' : null;
  return { run, label, active: state !== null };
}

/**
 * The top row: the brand, the sections, and whatever account controls the
 * product hands it. On a phone the sections move to the tab bar below and this
 * keeps only the two ends.
 */
function Navbar({ home = '/', links = [], right = null, hasTabBar = false }) {
  const demo = useDemoReseed();

  return (
    <header className="sticky top-0 z-50 w-full glass-panel">
      <div className="container mx-auto flex h-[56px] max-w-7xl items-center gap-2 px-4 sm:h-[68px] sm:gap-6 sm:px-6">
        <Link
          to={home}
          onDoubleClick={demo.run}
          className="group flex shrink-0 items-center gap-2.5 select-none"
        >
          <BrandMark />
          {/*
            * The wordmark used to be the first thing to go on a phone, because
            * the links were fighting it for the same row. They are not any
            * more — on a phone they live in the tab bar at the bottom — so the
            * name of the product can stay on screen where it belongs.
            *
            * It still folds away on the narrowest handsets alongside a nav that
            * has nowhere else to go (the guest app, with its single link).
            */}
          <span
            className={cn(
              'text-[15px] font-extrabold tracking-[0.16em]',
              hasTabBar ? 'inline' : 'hidden sm:inline',
              demo.active && 'text-primary-strong'
            )}
          >
            {demo.label ?? 'CHECKPOINT'}
          </span>
        </Link>

        {/*
          * On a phone this row carries the brand and the account controls and
          * nothing else; the sections are reachable from the tab bar instead of
          * from a strip that had to be scrolled sideways to be discovered.
          */}
        <nav
          className={cn(
            'no-scrollbar min-w-0 flex-1 items-center gap-0.5 overflow-x-auto sm:gap-1',
            hasTabBar ? 'hidden md:flex' : 'flex'
          )}
        >
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

        {hasTabBar && <span className="flex-1 md:hidden" />}

        {right && <div className="flex shrink-0 items-center gap-2 sm:gap-3">{right}</div>}
      </div>
    </header>
  );
}

/**
 * The navigation for anything narrower than a laptop: a bar of destinations
 * across the bottom of the screen, where a thumb already is.
 *
 * It replaces a sideways-scrolling strip in the header, which could not show
 * what it held: at 390px an admin's "Fleet" was entirely off the right-hand
 * edge, with nothing on screen to say a fourth section existed, and at 640px it
 * still was. The sections a product has should be visible, and reachable
 * without a gesture nobody thought to try — so this lasts until the medium
 * breakpoint, which is where the header can genuinely hold the links.
 *
 * Each destination gets an icon as well as a word, because at this size the
 * icon is what is read first and the word is what settles it.
 */
function MobileTabBar({ links }) {
  return (
    <nav
      /* Opaque, not glass: the rows scrolling underneath it were showing
         through a translucent bar and turning the labels into a smear. */
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card md:hidden"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom)',
        boxShadow: '0 -8px 24px -12px hsl(168 26% 22% / 0.28)',
      }}
      aria-label="Sections"
    >
      <div className="mx-auto flex max-w-lg items-stretch">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) =>
              cn(
                'relative flex min-w-0 flex-1 flex-col items-center gap-1 px-1 pb-2 pt-2.5 text-[11px] font-semibold leading-tight transition-colors',
                isActive ? 'text-primary-strong' : 'text-muted-foreground'
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.span
                    layoutId="tabbar-active"
                    className="absolute inset-x-2 top-0 h-[3px] rounded-b-full bg-primary"
                    initial={false}
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  />
                )}
                {link.icon && <link.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2.2} />}
                <span className="w-full truncate text-center">{link.shortLabel ?? link.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

/**
 * The shell every signed-in and guest page sits in.
 *
 * It owns the navigation rather than being handed a finished header, because
 * the two halves of that navigation now live at opposite ends of the screen on
 * a phone — the brand and account controls at the top, the sections in a tab
 * bar at the bottom — and something has to know about both to leave room for
 * the second one.
 *
 * A tab bar is only worth the screen it costs when there is somewhere to go:
 * with a single section it would be a label pretending to be a control, so the
 * guest app keeps its one link in the header.
 */
export function AppLayout({ children, home = '/', links = [], right = null }) {
  const location = useLocation();
  const hasTabBar = links.length > 1;

  return (
    <div className="relative flex min-h-[100dvh] flex-col bg-background text-foreground selection:bg-primary/20">
      <Navbar home={home} links={links} right={right} hasTabBar={hasTabBar} />

      <main
        className={cn(
          'relative z-10 mx-auto w-full max-w-7xl flex-1 px-4 py-7 sm:px-6 sm:py-10',
          // Clear of the tab bar, and of the home indicator underneath it.
          hasTabBar && 'pb-[calc(76px+env(safe-area-inset-bottom))] md:pb-10'
        )}
      >
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

      {hasTabBar && <MobileTabBar links={links} />}
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
export function PageHeader({
  title,
  description,
  actions,
  icon: Icon,
  still,
  bare,
  scene,
  sceneAtLabel,
  sceneHereLabel,
}) {
  const sceneRef = useRef(null);
  const busRef = useRef(null);
  const drive = useBusDrive(sceneRef, busRef, still || bare);

  if (scene) {
    return (
      <div className="mb-5 overflow-hidden rounded-xl border bg-card shadow-sm sm:mb-7">
        <BusStatusScene scene={scene} atLabel={sceneAtLabel} hereLabel={sceneHereLabel} />
        <div className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-end sm:gap-6 sm:p-5">
          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            {Icon && (
              <div className="mt-[3px] flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary-strong sm:h-12 sm:w-12">
                <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-[21px] font-black leading-tight tracking-tight sm:text-[27px]">
                {title}
              </h1>
              <HeaderDescription className="text-[14px] font-medium text-muted-foreground sm:text-[15px]">
                {description}
              </HeaderDescription>
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
            <div className="mt-[3px] flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary-strong sm:h-12 sm:w-12">
              <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-[22px] font-black leading-tight tracking-tight sm:text-[28px]">
              {title}
            </h1>
            <HeaderDescription className="text-[14px] font-medium text-muted-foreground sm:text-[15px]">
              {description}
            </HeaderDescription>
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
              <HeaderDescription className="mt-1.5 text-[13.5px] font-medium leading-relaxed text-primary-foreground sm:text-[14.5px]">
                {description}
              </HeaderDescription>
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

/**
 * The line under a page title, folded away on a phone.
 *
 * It explains the page, which is worth reading once and never again — and on a
 * 375px screen it pushed the first bus below the fold on the one screen people
 * open while standing at a stop. So it is two lines there, with a word to read
 * the rest, and whole from the small breakpoint up where it costs nothing.
 *
 * The toggle appears only when there is actually something hidden, measured
 * rather than guessed from the text length: the same sentence wraps
 * differently on every phone.
 */
function HeaderDescription({ children, className }) {
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const ref = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    measure();
    // Rotating the phone, or a font landing late, changes the answer.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children, open]);

  if (!children) return null;

  return (
    <div className={cn('mt-1 max-w-2xl', className)}>
      <p ref={ref} className={cn(!open && 'line-clamp-2 sm:line-clamp-none')}>
        {children}
      </p>
      {(clipped || open) && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-0.5 font-semibold underline underline-offset-2 sm:hidden"
        >
          {open ? 'Less' : 'More'}
        </button>
      )}
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
