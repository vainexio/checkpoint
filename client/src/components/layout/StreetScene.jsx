import { cn } from '@/lib/utils';

/**
 * The street the header bus is driving through.
 *
 * One rule holds the whole thing together: everything stands on the same
 * ground line, which is the top of the road. The skyline is anchored to it,
 * the trees and the shelter and the lamp sit on it, and the wheels of the bus
 * overhang it. Anything that drifts off that line reads as floating, which is
 * exactly what it looked like before.
 *
 * Depth comes from tone, not from stacking: the towers stay pale and flat far
 * back, and everything at the kerb is drawn darker so it separates cleanly
 * against them. Nothing here is interactive or announced to a screen reader.
 */

/* Ten wide towers, not eighteen thin ones. Fixed so the city never reshuffles. */
const BUILDINGS = [
  { w: 58, h: 235, cols: 3, rows: 9, tone: 'far' },
  { w: 44, h: 240, cols: 2, rows: 9, tone: 'mid' },
  { w: 72, h: 195, cols: 4, rows: 7, tone: 'far' },
  { w: 50, h: 208, cols: 3, rows: 8, tone: 'near' },
  { w: 64, h: 268, cols: 3, rows: 10, tone: 'far' },
  { w: 46, h: 158, cols: 2, rows: 6, tone: 'mid' },
  { w: 68, h: 222, cols: 4, rows: 8, tone: 'far' },
  { w: 42, h: 182, cols: 2, rows: 7, tone: 'near' },
  { w: 60, h: 255, cols: 3, rows: 9, tone: 'mid' },
  { w: 52, h: 148, cols: 3, rows: 5, tone: 'far' },
];

const TONE = {
  far: 'bg-primary/[0.18]',
  mid: 'bg-accent/[0.22]',
  near: 'bg-primary/[0.28]',
};

/* Lit on a fixed pattern rather than at random, so the city is stable. */
const isLit = (b, r, c) => (b * 7 + r * 5 + c * 3) % 5 < 2;

function Building({ spec, index }) {
  const { w, h, cols, rows, tone } = spec;
  return (
    <span
      className={cn('relative rounded-t-[4px]', TONE[tone])}
      style={{ flex: `${w} 1 0%`, height: h }}
    >
      <span
        className="absolute inset-x-[6px] bottom-[8px] top-[10px] grid gap-[4px]"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
        }}
      >
        {Array.from({ length: cols * rows }).map((_, i) => (
          <span
            key={i}
            className={cn(
              'rounded-[1px]',
              isLit(index, Math.floor(i / cols), i % cols)
                ? 'bg-warning/50'
                : 'bg-foreground/[0.08]'
            )}
          />
        ))}
      </span>
      {h > 230 && (
        <span className="absolute -top-4 left-1/2 h-4 w-[2px] -translate-x-1/2 rounded-full bg-foreground/20" />
      )}
    </span>
  );
}

function Tree({ big = false }) {
  return (
    <span className="flex shrink-0 flex-col items-center">
      <span className={cn('relative', big ? 'h-[52px] w-14' : 'h-10 w-11')}>
        <span className="absolute bottom-0 left-0 h-[70%] w-[70%] rounded-full scene-canopy-mid" />
        <span className="absolute bottom-0 right-0 h-[66%] w-[66%] rounded-full scene-canopy-back" />
        <span className="absolute left-1/2 top-0 h-[74%] w-[74%] -translate-x-1/2 rounded-full scene-canopy" />
      </span>
      <span className={cn('rounded-sm scene-trunk', big ? 'h-6 w-[5px]' : 'h-5 w-1')} />
    </span>
  );
}

/**
 * A lamp post: the head hangs off an arm at the top of the pole rather than
 * being centred over it, which is what made the old one look misaligned.
 */
function StreetLamp() {
  return (
    <span className="flex shrink-0 flex-col items-center">
      <span className="relative h-[92px] w-[3px] rounded-t-full scene-pole">
        <span className="absolute left-0 top-0 h-[3px] w-8 rounded-full scene-pole" />
        <span className="absolute left-[22px] top-[3px] h-2.5 w-5 rounded-b-[5px] scene-lamp" />
        <span className="absolute left-[18px] top-[5px] h-8 w-8 rounded-full bg-warning/35 blur-[9px]" />
      </span>
      <span className="h-1.5 w-4 rounded-t-[2px] scene-pole-dark" />
    </span>
  );
}

function Person({ tone = 'accent', h = 34 }) {
  const head = tone === 'accent' ? 'scene-person-head' : 'scene-person-head-alt';
  const body = tone === 'accent' ? 'scene-person-body' : 'scene-person-body-alt';
  return (
    <span className="flex shrink-0 flex-col items-center" style={{ height: h }}>
      <span className={cn('rounded-full', head)} style={{ height: h * 0.28, width: h * 0.28 }} />
      <span
        className={cn('mt-[2px] rounded-t-full', body)}
        style={{ height: h * 0.64, width: h * 0.44 }}
      />
    </span>
  );
}

/**
 * The waiting shed: a canopy on two posts, a route board on the back wall, a
 * bench, and the people using it. Everything is measured from the bottom of
 * the box so it plants on the kerb instead of hovering above it.
 */
function Shelter() {
  return (
    <span className="relative flex h-[92px] w-[132px] shrink-0 items-end">
      {/* Back wall, set behind everything else in the shed. */}
      <span className="absolute bottom-0 left-2 right-2 top-3 rounded-t-[3px] scene-shed-wall" />

      {/* Canopy, with a lip under it so it does not read as a floating bar. */}
      <span className="absolute inset-x-0 top-0 h-2.5 rounded-[3px] scene-shed" />
      <span className="absolute left-0 right-0 top-[10px] h-1 scene-shed-post" />

      {/* Posts, running the full drop to the kerb. */}
      <span className="absolute bottom-0 left-[3px] top-[10px] w-[4px] rounded-b-[2px] scene-shed-post" />
      <span className="absolute bottom-0 right-[3px] top-[10px] w-[4px] rounded-b-[2px] scene-shed-post" />

      {/* Route board. */}
      <span className="absolute right-3 top-[22px] grid h-11 w-[42px] content-start gap-[4px] rounded-[3px] bg-card p-2">
        <span className="h-[3px] w-full rounded-full scene-shed" />
        <span className="h-[3px] w-3/4 rounded-full scene-pole" />
        <span className="h-[3px] w-5/6 rounded-full scene-pole" />
        <span className="h-[3px] w-2/3 rounded-full scene-pole" />
      </span>

      {/* Bench on its legs, then the people standing in front of it. */}
      <span className="absolute bottom-[14px] left-3 h-[4px] w-[46px] rounded-full scene-shed-post" />
      <span className="absolute bottom-0 left-[18px] h-[14px] w-[3px] scene-shed-post" />
      <span className="absolute bottom-0 left-[46px] h-[14px] w-[3px] scene-shed-post" />
      <span className="absolute bottom-0 left-4 flex items-end gap-2">
        <Person tone="accent" h={40} />
        <Person tone="primary" h={33} />
      </span>
    </span>
  );
}

function TrafficLight() {
  return (
    <span className="flex shrink-0 flex-col items-center">
      <span className="flex h-12 w-[22px] flex-col items-center justify-center gap-[5px] rounded-[5px] scene-pole-dark">
        <span className="h-2.5 w-2.5 rounded-full scene-signal-off" />
        <span className="h-2.5 w-2.5 rounded-full scene-signal-off" />
        <span className="h-2.5 w-2.5 rounded-full bg-success" />
      </span>
      <span className="h-[62px] w-[4px] scene-pole" />
      <span className="h-1.5 w-4 rounded-t-[2px] scene-pole-dark" />
    </span>
  );
}

/** The skyline, standing on the ground line behind everything else. */
export function Skyline() {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-0 z-0 flex w-full origin-bottom items-end gap-[6px]',
        // A phone gets half the city, near full height, so the towers clear
        // the roof of the bus instead of hiding behind it.
        '[&>*:nth-child(even)]:hidden sm:[&>*:nth-child(even)]:block',
        'scale-y-[1.25] sm:scale-y-100'
      )}
      aria-hidden
    >
      {BUILDINGS.map((spec, i) => (
        <Building key={i} spec={spec} index={i} />
      ))}
    </div>
  );
}

/**
 * The stop that fills the road to the right of the bus. Hidden below `lg`,
 * where the bus already takes the full width and there is no kerb to furnish.
 */
export function BusStop() {
  return (
    <div
      className="relative hidden flex-1 items-end justify-between gap-4 pl-4 lg:flex"
      aria-hidden
    >
      <Tree big />
      <Shelter />
      <StreetLamp />
      <TrafficLight />
    </div>
  );
}
