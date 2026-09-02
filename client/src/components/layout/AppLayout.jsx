import { Link, NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
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
      transition={{ duration: 0.3, ease: 'easeOut' }}
      /*
       * Tightened hard on phones. At 375px the old header — 48px icon, 30px
       * title wrapping to two lines, a three-line description and stacked
       * buttons — used almost half the screen before the first bus appeared,
       * which is the one thing anyone opened the page for.
       */
      className="relative mb-6 flex flex-col justify-between gap-4 border-b border-border/60 pb-5 sm:mb-10 sm:gap-6 sm:pb-6 md:flex-row md:items-end"
    >
      <div className="absolute bottom-0 left-0 h-px w-24 bg-gradient-to-r from-primary to-transparent" />

      <div className="flex min-w-0 max-w-2xl items-start gap-3 sm:gap-4">
        {Icon && (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-accent/15 text-primary shadow-sm sm:h-12 sm:w-12 sm:rounded-2xl">
            <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-[26px] font-black leading-tight tracking-tight text-foreground sm:text-[34px]">
            {title}
          </h1>
          {description && (
            <div className="mt-1.5 text-[14px] font-medium text-muted-foreground sm:mt-2 sm:text-[15px]">
              {description}
            </div>
          )}
        </div>
      </div>
      {/* Actions wrap into a row on a phone instead of stacking full-width. */}
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:gap-3">{actions}</div>
      )}
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
    <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
      </span>
      {lastUpdated ? `Updated ${formatTime(lastUpdated)}` : 'Connecting…'}
    </span>
  );
}
