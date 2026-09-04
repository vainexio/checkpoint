import { useEffect, useState } from 'react';
import { motion, useTransform } from 'framer-motion';
import { cn } from '@/lib/utils';
import { BusStop, Skyline } from './StreetScene.jsx';

/**
 * The bus, and the street it stands in.
 *
 * Pulled out of the page header so the sign-in page can put the same vehicle
 * on the same road. What differs between them is only what moves it: the
 * header hands in a scroll-driven position, sign-in hands in an animated one.
 * Neither knows how the other works.
 */

/* Axle positions along the coach, as a percentage of its length. */
const WHEEL_AT = [20, 80];

/**
 * Measures the street: how far the bus must travel to be gone, how far back it
 * has to start to come in off-screen, and how tall the whole scene is.
 *
 * A ResizeObserver keeps it honest, because these heights settle after the
 * first paint and a box read once and cached is how this sort of thing ends up
 * mistimed.
 */
export function useStreetGeometry(sceneRef, busRef) {
  const [geo, setGeo] = useState({ exit: 1400, enter: 900, wheel: 62, span: 480, ready: false });

  useEffect(() => {
    const scene = sceneRef.current;
    const bus = busRef.current;
    if (!scene || !bus) return undefined;

    const measure = () => {
      const box = scene.getBoundingClientRect();
      // The row is never transformed, so its left edge is the bus at rest —
      // reading the bus itself would fold in however far it has already driven.
      const home = bus.parentElement.getBoundingClientRect().left;
      setGeo({
        exit: Math.max(240, window.innerWidth - home + 24),
        enter: home + bus.offsetWidth + 24,
        wheel: window.matchMedia('(min-width: 640px)').matches ? 62 : 44,
        span: box.top + window.scrollY + box.height,
        ready: true,
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scene);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [sceneRef, busRef]);

  return geo;
}

/**
 * Wheel rotation for a given position.
 *
 * Derived from where the bus is rather than from whatever is driving it, so
 * the wheels can only ever turn the way the bus is going, as fast as it is
 * going — forwards, backwards, or not at all.
 */
export function useWheelSpin(x, wheelDiameter) {
  return useTransform(x, (px) => (px / (Math.PI * wheelDiameter)) * 360);
}

function Wheels({ spin, still }) {
  return WHEEL_AT.map((pct) => (
    <motion.span
      key={pct}
      className="absolute -bottom-[22px] z-20 grid h-11 w-11 place-items-center rounded-full bg-[#141A17] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)] sm:-bottom-[31px] sm:h-[62px] sm:w-[62px]"
      style={{ left: `${pct}%`, x: '-50%', rotate: still ? 0 : spin }}
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
  ));
}

/**
 * The coach itself. Whatever is passed as children becomes its flank, which is
 * the only part that changes from page to page.
 */
export function Bus({ busRef, x, spin, still, children }) {
  return (
    <motion.div
      ref={busRef}
      style={still ? undefined : { x }}
      // A transform makes this a stacking context, so the body's z-10 and the
      // wheels' z-20 become purely internal. Without a layer of its own the
      // bus drives behind the shelter it is supposed to be passing.
      className="relative z-20 w-full max-w-[820px] shrink-0"
    >
      {/*
        * Wheels, drawn over the body rather than behind it.
        *
        * Tucked behind, only the lower half ever showed, and half a wheel
        * carries no detail. Sitting on top, the whole circle reads, so it gets
        * the full build: tyre, rim, six lug nuts and a hub.
        */}
      <Wheels spin={spin} still={still} />

      <div className="relative z-10 overflow-hidden rounded-[12px] bg-primary text-primary-foreground sm:rounded-[14px]">
        {/* Glazing: four saloon windows, the door, then the windscreen. */}
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
            <span className="absolute inset-x-1 bottom-1 top-1 rounded-[3px] bg-primary-foreground/[0.14]" />
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-primary/30" />
          </span>
          <span className="relative h-8 flex-[1.35] overflow-hidden rounded-[4px] rounded-tr-[10px] bg-primary-foreground/[0.24] sm:h-10 sm:rounded-tr-[12px]">
            <span className="absolute inset-x-0 top-0 h-1/3 bg-primary-foreground/[0.12]" />
          </span>
        </div>

        {children}

        {/* Sill, with a tail lamp at the back and an indicator at the front. */}
        <div className="relative h-3 bg-accent/25 sm:h-4" aria-hidden>
          <span className="absolute bottom-[3px] left-3 h-1.5 w-3.5 rounded-[2px] bg-destructive/75 sm:left-4 sm:w-4" />
          <span className="absolute bottom-[3px] right-3 h-1.5 w-5 rounded-[2px] bg-warning/85 sm:right-4 sm:w-6" />
        </div>
      </div>
    </motion.div>
  );
}

/**
 * The whole scene: city behind, bus and stop on the ground line, road under
 * both.
 *
 * The bottom of the ground box is the top of the road, and everything
 * bottom-aligns to it. Hanging the city off the outer wrapper instead put it a
 * road-height below everything else, which made the street look like it was
 * floating.
 */
export function Street({ sceneRef, busRef, x, spin, still, className, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
      ref={sceneRef}
      // Clipped, so a bus on its way out cannot widen the page.
      className={cn('relative overflow-hidden pt-16 sm:pt-16 lg:pt-24', className)}
    >
      <div className="relative">
        <Skyline />

        <div className="relative z-10 flex items-end gap-5 xl:gap-7">
          <Bus busRef={busRef} x={x} spin={spin} still={still}>
            {children}
          </Bus>
          <BusStop />
        </div>
      </div>

      {/* The road sits between the city and the vehicle: in front of the
          skyline, under the tyres. */}
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
  );
}
