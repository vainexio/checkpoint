import { Link, NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Skyline, BusStop } from './StreetScene.jsx';
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
          * No `mode="wait"`, and no exit animation.
          *
          * With both, the incoming route could not mount until the outgoing
          * one had finished animating away — and an exit that gets
          * interrupted, which is exactly what the browser back button does,
          * leaves the presence tracking with nothing on screen. That is the
          * blank page you had to refresh out of. The entrance is what gives
          * the transition its polish; the exit was only ever buying the bug.
          */}
        <AnimatePresence initial={false}>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
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
    <div className="mb-5 sm:mb-7">
      {/*
        * The bus keeps its own proportions; the street fills the rest.
        *
        * Capping the panel stopped it stretching, but left dead space beside
        * it on a wide screen. Rather than growing the bus back out of shape,
        * the space becomes the road it is driving on and the stop it is
        * pulling into — so the width is used without the vehicle paying for
        * it.
        */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
        className="relative pt-16 sm:pt-16 lg:pt-24"
      >
        {/*
          * The ground line.
          *
          * The bottom of this box is the top of the road, and everything in
          * the scene bottom-aligns to it: the skyline behind, the bus, and the
          * stop furniture beside it. Hanging the city off the outer wrapper
          * instead put it a road-height lower than everything else, which is
          * what made the whole street look like it was floating.
          */}
        <div className="relative">
          <Skyline />

          <div className="relative z-10 flex items-end gap-5 xl:gap-7">
            {/* -------------------------------------------------------- the bus */}
            <div className="relative w-full max-w-[620px] shrink-0">
              {/* Tyres, behind the body so only their lower halves show. */}
              <span
                className="absolute -bottom-[13px] left-[16%] z-0 grid h-8 w-8 place-items-center rounded-full bg-[#171D1B] sm:-bottom-[16px] sm:h-10 sm:w-10"
                aria-hidden
              >
                <span className="h-2.5 w-2.5 rounded-full bg-background/85 sm:h-3 sm:w-3" />
              </span>
              <span
                className="absolute -bottom-[13px] right-[18%] z-0 grid h-8 w-8 place-items-center rounded-full bg-[#171D1B] sm:-bottom-[16px] sm:h-10 sm:w-10"
                aria-hidden
              >
                <span className="h-2.5 w-2.5 rounded-full bg-background/85 sm:h-3 sm:w-3" />
              </span>

              <div className="relative z-10 overflow-hidden rounded-[12px] bg-primary text-primary-foreground sm:rounded-[14px]">
                <div className="flex items-center gap-2 px-3 pt-3 sm:gap-2.5 sm:px-4 sm:pt-4" aria-hidden>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <span
                      key={i}
                      className="relative h-8 flex-1 overflow-hidden rounded-[4px] bg-primary-foreground/[0.18] sm:h-10"
                    >
                      <span className="absolute inset-x-0 top-0 h-1/3 bg-primary-foreground/[0.12]" />
                      <span className="absolute inset-y-1 right-1/3 w-px bg-primary/25" />
                    </span>
                  ))}
                  <span className="relative h-8 w-6 shrink-0 overflow-hidden rounded-[4px] bg-accent/40 sm:h-10 sm:w-8">
                    <span className="absolute inset-x-1 top-1 bottom-1 rounded-[3px] bg-primary-foreground/[0.14]" />
                    <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-primary/30" />
                  </span>
                  <span className="relative h-8 flex-[1.35] overflow-hidden rounded-[4px] rounded-tr-[10px] bg-primary-foreground/[0.24] sm:h-10 sm:rounded-tr-[12px]">
                    <span className="absolute inset-x-0 top-0 h-1/3 bg-primary-foreground/[0.12]" />
                  </span>
                </div>

                <div className="flex items-center gap-3 px-4 py-3.5 sm:gap-4 sm:px-5 sm:py-4">
                  {Icon && (
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-foreground/20 sm:h-11 sm:w-11">
                      <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                    </div>
                  )}
                  <h1 className="min-w-0 text-[21px] font-black leading-tight tracking-tight sm:text-[27px]">
                    {title}
                  </h1>
                </div>

                <div className="relative h-3 bg-accent/25 sm:h-4" aria-hidden>
                  <span className="absolute bottom-[3px] left-3 h-1.5 w-3.5 rounded-[2px] bg-destructive/75 sm:left-4 sm:w-4" />
                  <span className="absolute bottom-[3px] right-3 h-1.5 w-5 rounded-[2px] bg-warning/85 sm:right-4 sm:w-6" />
                </div>
              </div>
            </div>

            <BusStop />
          </div>
        </div>

        {/* ------------------------------------------------------------ road */}
        <div
          className="relative z-10 mt-[6px] h-3.5 rounded-[3px] bg-foreground/[0.22] sm:mt-2 sm:h-4"
          aria-hidden
        >
          <div className="absolute inset-x-4 top-1/2 flex -translate-y-1/2 gap-4">
            {Array.from({ length: 16 }).map((_, i) => (
              <span key={i} className="h-[2px] flex-1 rounded-full bg-background/60" />
            ))}
          </div>
        </div>
      </motion.div>

      {/* Everything that is not the name lives on the page, below the street. */}
      {(description || actions) && (
        <div className="mt-5 flex flex-col justify-between gap-3 sm:mt-6 sm:flex-row sm:items-end sm:gap-6">
          {description && (
            <p className="m-0 max-w-2xl text-[14px] font-medium text-muted-foreground sm:text-[15px]">
              {description}
            </p>
          )}
          {actions && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:gap-3">{actions}</div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Updates arrive when a conductor taps, not on a ticker — but a board that
 * never visibly moves reads as broken. This says plainly when the screen last
 * checked, which is the truthful version of "live".
 */
export function LiveIndicator({ lastUpdated }) {
  return (
    <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
      </span>
      {lastUpdated ? `Updated ${formatTime(lastUpdated)}` : 'Connecting…'}
    </span>
  );
}
