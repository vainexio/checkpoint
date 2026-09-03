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
        * The panel is the side of a bus, and the bodywork is laid out in bands
        * rather than painted behind the words.
        *
        * The first version had the door, the livery stripe and the lamps as
        * absolute overlays across the whole panel, which meant every one of
        * them cut through the title. Here the glazing is its own band, the
        * content sits on the flank panel a real bus carries its advertising
        * on, and the door has its own column beside it. Nothing overlaps
        * because nothing shares a zone.
        */}

      {/* Wheels, behind the body so only their lower halves show. */}
      <span
        className="absolute -bottom-5 left-[14%] z-0 grid h-12 w-12 place-items-center rounded-full bg-[#171D1B] sm:-bottom-6 sm:h-15 sm:w-15"
        aria-hidden
      >
        <span className="h-4 w-4 rounded-full bg-background/85 sm:h-5 sm:w-5" />
      </span>
      <span
        className="absolute -bottom-5 right-[16%] z-0 grid h-12 w-12 place-items-center rounded-full bg-[#171D1B] sm:-bottom-6 sm:h-15 sm:w-15"
        aria-hidden
      >
        <span className="h-4 w-4 rounded-full bg-background/85 sm:h-5 sm:w-5" />
      </span>

      <div className="relative z-10 overflow-hidden rounded-[14px] bg-primary text-primary-foreground sm:rounded-[18px]">
        {/* ---------------------------------------------------- glazing band */}
        <div className="flex items-center gap-2.5 bg-accent/25 px-4 py-3 sm:gap-3 sm:px-6 sm:py-4" aria-hidden>
          {Array.from({ length: 5 }).map((_, i) => (
            <span
              key={i}
              className="relative h-7 flex-1 overflow-hidden rounded-[5px] bg-primary-foreground/[0.16] sm:h-9 sm:rounded-md"
            >
              <span className="absolute inset-x-0 top-0 h-1/3 bg-primary-foreground/[0.12]" />
              <span className="absolute inset-y-1 right-1/3 w-px bg-primary/20" />
            </span>
          ))}
          {/* The windscreen: wider, and raked at the nose. */}
          <span className="relative h-7 flex-[1.5] overflow-hidden rounded-[5px] rounded-tr-[14px] bg-primary-foreground/[0.2] sm:h-9 sm:rounded-md sm:rounded-tr-[18px]">
            <span className="absolute inset-x-0 top-0 h-1/3 bg-primary-foreground/[0.12]" />
          </span>
        </div>

        {/* ------------------------------------------- flank: content + door */}
        <div className="flex items-stretch gap-3 px-4 pb-4 pt-4 sm:gap-4 sm:px-6 sm:pb-5 sm:pt-5">
          {/* The advertising panel every bus carries, which is also the only
              surface any text sits on. */}
          <div className="min-w-0 flex-1 rounded-lg bg-primary-foreground/[0.08] px-4 py-4 sm:rounded-xl sm:px-6 sm:py-5">
            <div className="flex flex-col justify-between gap-4 sm:gap-6 md:flex-row md:items-end">
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

          {/* Boarding door, in its own column so it can never sit under a word. */}
          <div
            className="relative hidden w-12 shrink-0 rounded-md bg-accent/25 sm:block"
            aria-hidden
          >
            <span className="absolute inset-x-2 top-2.5 bottom-12 rounded-[4px] bg-primary-foreground/[0.14]" />
            <span className="absolute inset-y-3 left-1/2 w-px -translate-x-1/2 bg-primary/25" />
            <span className="absolute bottom-3 left-1/2 h-1 w-4 -translate-x-1/2 rounded-full bg-primary-foreground/25 sm:bottom-4 sm:w-5" />
          </div>
        </div>

        {/* ------------------------------------------------- sill and lamps */}
        <div className="relative h-4 bg-accent/20 sm:h-5" aria-hidden>
          <span className="absolute bottom-1 left-4 h-2 w-4 rounded-sm bg-destructive/70 sm:bottom-1.5 sm:left-6 sm:w-5" />
          <span className="absolute bottom-1 right-4 h-2 w-6 rounded-sm bg-warning/80 sm:bottom-1.5 sm:right-6 sm:w-8" />
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
