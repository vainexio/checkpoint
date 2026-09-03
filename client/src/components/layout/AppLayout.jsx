import { Link, NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Bus } from 'lucide-react';
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
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="h-full w-full"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

export function PageHeader({ title, description, actions, icon: Icon }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
      className="relative mb-9 sm:mb-11"
    >
      {/*
        * The header is drawn as the side of a bus.
        *
        * Not an icon dropped onto a panel — the panel itself is the vehicle:
        * a long body with a row of windows across the top, a livery stripe
        * down the flank, and wheels sitting under it on the page. The
        * proportions of a page header happen to be the proportions of a bus
        * seen from the side, which is the whole reason this works.
        */}

      {/* Wheels, behind the body so only their lower halves show. */}
      <span
        className="absolute -bottom-5 left-[15%] z-0 grid h-12 w-12 place-items-center rounded-full bg-accent sm:-bottom-6 sm:h-15 sm:w-15"
        aria-hidden
      >
        <span className="h-4 w-4 rounded-full bg-background/70 sm:h-5 sm:w-5" />
      </span>
      <span
        className="absolute -bottom-5 right-[17%] z-0 grid h-12 w-12 place-items-center rounded-full bg-accent sm:-bottom-6 sm:h-15 sm:w-15"
        aria-hidden
      >
        <span className="h-4 w-4 rounded-full bg-background/70 sm:h-5 sm:w-5" />
      </span>

      {/* The body. */}
      <div className="relative z-10 overflow-hidden rounded-[30px] bg-primary px-5 pb-7 pt-5 text-primary-foreground sm:rounded-[38px] sm:px-8 sm:pb-9 sm:pt-7">
        {/*
          * The bodywork, drawn front-to-the-right so it reads in the direction
          * of travel: saloon windows, then a wider windscreen at the nose, a
          * boarding door behind the front axle, a livery stripe along the
          * flank, and lamps at both ends.
          *
          * All of it is set well back in opacity. It is the panel the title
          * sits on, not an illustration the title has to compete with.
          */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[62px] bg-accent/25 sm:h-[76px]"
          aria-hidden
        >
          <div className="flex h-full items-center gap-2.5 px-5 sm:gap-3 sm:px-8">
            {Array.from({ length: 5 }).map((_, i) => (
              <span
                key={i}
                className="relative h-7 flex-1 overflow-hidden rounded-lg bg-primary-foreground/[0.16] sm:h-10 sm:rounded-xl"
              >
                {/* The light catching the top of the glass. */}
                <span className="absolute inset-x-0 top-0 h-1/3 bg-primary-foreground/[0.13]" />
                {/* Sliding pane: the vertical bar every bus window has. */}
                <span className="absolute inset-y-1 right-1/3 w-px bg-primary/25" />
              </span>
            ))}
            {/* The windscreen: wider, and raked at the nose. */}
            <span className="relative h-7 flex-[1.55] overflow-hidden rounded-lg rounded-tr-[18px] bg-primary-foreground/[0.2] sm:h-10 sm:rounded-xl sm:rounded-tr-[26px]">
              <span className="absolute inset-x-0 top-0 h-1/3 bg-primary-foreground/[0.14]" />
            </span>
          </div>
        </div>
        <div
          className="pointer-events-none absolute inset-x-0 top-[62px] h-[3px] bg-primary-foreground/25 sm:top-[76px] sm:h-1"
          aria-hidden
        />

        {/*
          * Boarding door, behind the front axle.
          *
          * It runs the full height of the body rather than starting below the
          * glass — a door that stops short of the window line reads as a box
          * someone left on the panel, which is exactly how the first attempt
          * looked. The glazed upper half lines up with the saloon windows.
          */}
        <div
          className="pointer-events-none absolute inset-y-0 right-[26%] w-[42px] bg-accent/[0.18] sm:right-[28%] sm:w-[56px]"
          aria-hidden
        >
          {/* Leading and trailing edges, so it reads as an opening. */}
          <span className="absolute inset-y-0 left-0 w-px bg-primary/25" />
          <span className="absolute inset-y-0 right-0 w-px bg-primary/25" />
          {/* Door glass, aligned to the window band above it. */}
          <span className="absolute inset-x-1.5 top-2 h-[46px] rounded-md bg-primary-foreground/[0.13] sm:inset-x-2 sm:top-2.5 sm:h-[62px]" />
          {/* The split where the two leaves meet. */}
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-primary/20" />
        </div>

        {/* Livery stripe along the flank. */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-9 h-1.5 bg-primary-foreground/[0.1] sm:bottom-11 sm:h-2"
          aria-hidden
        />

        {/* Lamps: warm at the nose, red at the tail. */}
        <span
          className="pointer-events-none absolute bottom-3.5 right-3 h-2.5 w-5 rounded-md bg-warning/70 sm:bottom-5 sm:right-5 sm:h-3 sm:w-7"
          aria-hidden
        />
        <span
          className="pointer-events-none absolute bottom-3.5 left-3 h-2.5 w-4 rounded-md bg-destructive/60 sm:bottom-5 sm:left-5 sm:h-3 sm:w-5"
          aria-hidden
        />

        <div className="relative flex flex-col justify-between gap-4 pt-11 sm:gap-6 sm:pt-14 md:flex-row md:items-end">
          <div className="flex min-w-0 max-w-2xl items-start gap-3 sm:gap-4">
            {Icon && (
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-foreground/20 sm:h-13 sm:w-13">
                <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-[26px] font-black leading-tight tracking-tight sm:text-[34px]">
                {title}
              </h1>
              {description && (
                <div className="mt-1.5 text-[14px] font-medium text-primary-foreground/80 sm:mt-2 sm:text-[15px]">
                  {description}
                </div>
              )}
            </div>
          </div>

          {actions && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:gap-3">{actions}</div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Updates arrive when a conductor taps, not on a ticker — but a board that
 * never visibly moves reads as broken. This says plainly when the screen last
 * checked, which is the truthful version of "live".
 */
export function LiveIndicator({ lastUpdated }) {
  return (
    <span className="flex items-center gap-2 text-xs font-medium opacity-80">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
      </span>
      {lastUpdated ? `Updated ${formatTime(lastUpdated)}` : 'Connecting…'}
    </span>
  );
}
