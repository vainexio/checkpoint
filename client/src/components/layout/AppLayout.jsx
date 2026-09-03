import { Link, NavLink, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
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

/* Axle positions along the coach, as a percentage of its length. */
const WHEEL_AT = [20, 80];

/* Never tie the drive to a span so short that a nudge throws the bus off. */
const MIN_DRIVE_SPAN = 260;

/**
 * Drives the header bus off to the right as the page scrolls, and rolls its
 * wheels at the rate the distance actually calls for.
 *
 * The span is measured rather than guessed: the bus should be gone at roughly
 * the moment the header itself clears the top of the window, which depends on
 * how many lines the description wraps to. A ResizeObserver keeps that honest
 * when the height settles after the first paint — reading the box once and
 * caching it is exactly how this kind of effect ends up mistimed.
 *
 * Rotation is derived from x rather than from scroll, so the wheels can only
 * ever turn in the direction the bus is moving, at the speed it is moving.
 * Scroll back up and the bus reverses in with its wheels turning backwards,
 * which is what a bus pulling back to the kerb does.
 */
function useBusDrive(ref) {
  const { scrollY } = useScroll();
  const [drive, setDrive] = useState({ span: 480, travel: 1440, wheel: 62 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      setDrive({
        span: Math.max(MIN_DRIVE_SPAN, rect.top + window.scrollY + rect.height),
        // Past the right edge of the window, whatever the container is doing.
        travel: window.innerWidth + 160,
        wheel: window.matchMedia('(min-width: 640px)').matches ? 62 : 44,
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref]);

  const x = useTransform(scrollY, [0, drive.span], [0, drive.travel], { clamp: true });
  const spin = useTransform(x, (px) => (px / (Math.PI * drive.wheel)) * 360);

  return { x, spin };
}

export function PageHeader({ title, description, actions, icon: Icon }) {
  const sceneRef = useRef(null);
  const { x, spin } = useBusDrive(sceneRef);
  const stillness = useReducedMotion();

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
        ref={sceneRef}
        // Clipped, so a bus on its way out cannot widen the page.
        className="relative overflow-hidden pt-16 sm:pt-16 lg:pt-24"
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
            <motion.div
              style={stillness ? undefined : { x }}
              className="relative z-20 w-full max-w-[820px] shrink-0"
            >
              {/*
                * Wheels.
                *
                * The old pair were 40px on an 820px coach, near-black against
                * a dark road, with only a sliver showing below the body: a
                * smudge, not a wheel. These are sized to the vehicle and built
                * in rings, so the part that does show below the arch carries
                * the detail — tyre, pale rim, hub and lug nuts, each reading
                * against the one outside it.
                */}
              {/*
                * Wheels, drawn over the body rather than behind it.
                *
                * Tucked behind, only the lower half ever showed, and half a
                * wheel cannot carry any detail. Sitting on top, the whole
                * circle reads, so it gets the full build: tyre, rim, six lug
                * nuts and a hub.
                */}
              {WHEEL_AT.map((pct) => (
                <motion.span
                  key={pct}
                  className="absolute -bottom-[22px] z-20 grid h-11 w-11 place-items-center rounded-full bg-[#141A17] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)] sm:-bottom-[31px] sm:h-[62px] sm:w-[62px]"
                  style={{ left: `${pct}%`, x: '-50%', rotate: stillness ? 0 : spin }}
                  aria-hidden
                >
                  {/* Rim, lug nuts and hub, lit from above by the inset shade. */}
                  <span className="relative grid h-[26px] w-[26px] place-items-center rounded-full bg-[#E2E8E1] shadow-[inset_0_-2px_3px_rgba(20,26,23,0.28)] sm:h-[34px] sm:w-[34px]">
                    {[0, 60, 120, 180, 240, 300].map((deg) => (
                      <span
                        key={deg}
                        className="absolute h-[3px] w-[3px] rounded-full bg-[#8D9A94] sm:h-[4px] sm:w-[4px]"
                        style={{ transform: `rotate(${deg}deg) translateY(-9px)` }}
                      />
                    ))}
                    <span className="h-2.5 w-2.5 rounded-full bg-[#6F7C77] sm:h-3.5 sm:w-3.5" />
                  </span>
                </motion.span>
              ))}

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

                {/*
                  * The flank carries the name, the line under it, and the
                  * controls. Laid out in bands rather than overlays: the icon
                  * and the words in one column, the actions in another, so
                  * nothing can land on top of the text the way it used to.
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
                    <div className="flex shrink-0 flex-wrap items-center gap-2 sm:gap-3">
                      {actions}
                    </div>
                  )}
                </div>

                <div className="relative h-3 bg-accent/25 sm:h-4" aria-hidden>
                  <span className="absolute bottom-[3px] left-3 h-1.5 w-3.5 rounded-[2px] bg-destructive/75 sm:left-4 sm:w-4" />
                  <span className="absolute bottom-[3px] right-3 h-1.5 w-5 rounded-[2px] bg-warning/85 sm:right-4 sm:w-6" />
                </div>

              </div>
            </motion.div>

            <BusStop />
          </div>
        </div>

        {/* ------------------------------------------------------------ road */}
        <div
          className="relative z-0 mt-[5px] h-[19px] rounded-[3px] bg-foreground/[0.22] sm:mt-[6px] sm:h-7"
          aria-hidden
        >
          <div className="absolute inset-x-4 top-1/2 flex -translate-y-1/2 gap-4">
            {Array.from({ length: 16 }).map((_, i) => (
              <span key={i} className="h-[2px] flex-1 rounded-full bg-background/60" />
            ))}
          </div>
        </div>
      </motion.div>

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
    <span className="flex items-center gap-2 text-xs font-medium text-primary-foreground">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
      </span>
      {lastUpdated ? `Updated ${formatTime(lastUpdated)}` : 'Connecting…'}
    </span>
  );
}
