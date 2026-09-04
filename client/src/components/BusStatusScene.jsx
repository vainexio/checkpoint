import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * A small drawn scene showing what a bus is doing, for the glance before
 * anyone reads the badges.
 *
 * The thing being drawn is *where the bus is relative to you*, because that is
 * the question someone at a stop is actually asking. An earlier version let
 * "full" and "waiting" drive the whole picture, so a full bus forty minutes
 * away and a bus parked at its origin two provinces over both drew as a bus
 * standing at the stop you were looking at. Both were lies.
 *
 * So place decides the composition, and everything else is a modifier on top:
 *
 *   atStop      it is here, in front of you, doors open
 *   elsewhere   parked at a different stop, with the road between you and it
 *   travelling  on the road, coming toward you
 *   done        the trip is over
 *
 * Two rules carried over from the page header. Everything stands on the road
 * line, because anything drifting off it reads as floating. And nothing is
 * drawn with an alpha: the band paints itself the page colour and the figures
 * use the same opaque `scene-*` mixes the street uses, so none of them turn
 * into ghosts over a tinted card.
 */

const BAND = 'relative h-[70px] overflow-hidden bg-background sm:h-[82px]';

/**
 * The stop-start crawl of a queue in traffic.
 *
 * One vehicle edges forward at a time, and everything holds for a beat
 * between moves, which is what congestion actually looks like from inside it:
 * the car ahead pulls away, the bus closes the gap, the car behind closes its
 * own.
 *
 * It loops seamlessly because the camera rides with the bus, so these are
 * *relative* positions. The car ahead gains a length and gives it straight
 * back when the bus catches up; the car behind loses one when the bus pulls
 * away and takes it back in turn. Every offset ends the cycle where it
 * started, so nothing has to snap. Animating absolute positions instead would
 * drift the whole queue off the end of the road.
 */
const CRAWL = 4.5;
const HOP = 14;
/* One dash plus one gap. Sliding the road by exactly this per cycle means the
   pattern lands on itself and the restart cannot be seen. */
const ROAD_PITCH = 36;

const CRAWL_AHEAD = { x: [0, HOP, HOP, 0, 0], times: [0, 0.11, 0.33, 0.44, 1] };
const CRAWL_BEHIND = {
  x: [0, 0, -HOP, -HOP, 0, 0],
  times: [0, 0.33, 0.44, 0.67, 0.78, 1],
};
const CRAWL_ROAD = { x: [0, 0, -ROAD_PITCH, -ROAD_PITCH], times: [0, 0.33, 0.44, 1] };

/**
 * Boarding: a queue walking into the door and being replaced behind.
 *
 * Each passenger fades in at the back of the queue, walks up to the door and
 * fades out as they step aboard, and the three of them are spaced a third of a
 * cycle apart so someone is always on the move. The fade matters at both ends:
 * a passenger is invisible when the loop restarts them, so the jump from the
 * door back to the end of the queue is never seen.
 */
const BOARD_CYCLE = 3.3;
const BOARD_WALK = 40;
const BOARDING = {
  x: [BOARD_WALK, BOARD_WALK - 5, 6, 0],
  opacity: [0, 1, 1, 0],
};
const BOARDING_TIMES = [0, 0.14, 0.86, 1];
const CRAWL_TIMING = { duration: CRAWL, repeat: Infinity, ease: 'easeInOut' };

/**
 * Fits a station name on a bus stop sign.
 *
 * "Terminal" and "Station" are what the sign is, not what it says — every
 * name on the network ends in one, so they carry nothing and cost the width
 * that the actual place name needs. Truncation is still there underneath as
 * the backstop for anything long that survives this.
 */
export function shortStationName(name) {
  if (!name) return '';
  return name.replace(/\s+(bus\s+|transport\s+)?(terminal|station)$/i, '').trim() || name;
}

function Wheel({ left }) {
  return (
    <span
      className="absolute bottom-[-7px] z-20 grid h-[18px] w-[18px] -translate-x-1/2 place-items-center rounded-full bg-[#141A17]"
      style={{ left }}
      aria-hidden
    >
      <span className="h-[7px] w-[7px] rounded-full bg-[#E2E8E1]" />
    </span>
  );
}

function Person({ h = 24, tone = 'accent' }) {
  const head = tone === 'accent' ? 'scene-person-head' : 'scene-person-head-alt';
  const body = tone === 'accent' ? 'scene-person-body' : 'scene-person-body-alt';
  return (
    <span className="flex shrink-0 flex-col items-center" style={{ height: h }}>
      <span className={cn('rounded-full', head)} style={{ height: h * 0.3, width: h * 0.3 }} />
      <span
        className={cn('mt-[1px] rounded-t-full', body)}
        style={{ height: h * 0.62, width: h * 0.46 }}
      />
    </span>
  );
}

/**
 * A stop. The sign turns amber when the bus due here is running late — a
 * delay notice on the sign itself, rather than an icon floating beside it.
 */
function StopPole({ alert = false, label }) {
  const text = shortStationName(label);
  return (
    <span className="flex min-w-0 shrink flex-col items-center" aria-hidden>
      {/*
        * The name goes on the sign itself. A real stop sign is where a stop's
        * name lives, so it needs no floating caption and stays attached to the
        * thing it names.
        */}
      <span
        className={cn(
          'flex h-4 items-center justify-center rounded-[2px] sm:h-[18px]',
          text ? 'max-w-[92px] px-1.5 sm:max-w-[128px] sm:px-2' : 'w-7',
          alert ? 'bg-warning' : 'bg-primary'
        )}
      >
        {text ? (
          <span
            className={cn(
              'truncate text-[8px] font-bold uppercase tracking-[0.05em] sm:text-[9px]',
              alert ? 'text-foreground' : 'text-primary-foreground'
            )}
          >
            {text}
          </span>
        ) : (
          <span
            className={cn(
              'h-[3px] w-3.5 rounded-full',
              alert ? 'bg-foreground/50' : 'bg-primary-foreground/70'
            )}
          />
        )}
      </span>
      <span className="h-[30px] w-[3px] scene-pole" />
    </span>
  );
}

/**
 * Other traffic.
 *
 * Built the way the bus is, so the queue looks like one family of vehicles: a
 * body with a cabin sitting on it rather than a single slab, glass divided by
 * a pillar, a lamp at each end, and tyres with the same pale rim. Two shapes,
 * because a row of identical cars reads as wallpaper.
 */
function Car({ shape = 'sedan', alt = false }) {
  const van = shape === 'van';
  const paint = alt ? 'scene-car-alt' : 'scene-car';

  return (
    <span
      className="relative block h-[18px] w-[38px] shrink-0 sm:h-[21px] sm:w-[44px]"
      aria-hidden
    >
      {/* Cabin. A van carries its roof further forward and higher. */}
      <span
        className={cn(
          'absolute rounded-t-[4px]',
          paint,
          van
            ? 'bottom-[8px] left-[4px] right-[7px] h-[9px] sm:bottom-[9px] sm:h-[11px]'
            : 'bottom-[8px] left-[7px] right-[9px] h-[7px] sm:bottom-[9px] sm:h-[9px]'
        )}
      >
        {/* Glass, split by a pillar. */}
        <span className="absolute inset-[2px] flex gap-[2px]">
          <span className="flex-1 rounded-[1px] scene-car-glass" />
          <span className="flex-[0.65] rounded-[1px] scene-car-glass" />
        </span>
      </span>

      {/* Body. */}
      <span className={cn('absolute inset-x-0 bottom-[3px] h-[9px] rounded-[3px] sm:h-[10px]', paint)}>
        <span className="absolute bottom-[2px] left-0 h-[3px] w-[3px] rounded-[1px] bg-destructive/80" />
        <span className="absolute bottom-[2px] right-0 h-[3px] w-[3px] rounded-[1px] bg-warning" />
      </span>

      {/* Tyres, rimmed like the coach's so the queue matches. */}
      {['22%', '76%'].map((left) => (
        <span
          key={left}
          className="absolute bottom-0 grid h-[11px] w-[11px] -translate-x-1/2 place-items-center rounded-full bg-[#141A17] sm:h-[12px] sm:w-[12px]"
          style={{ left }}
        >
          <span className="h-[4px] w-[4px] rounded-full bg-[#E2E8E1]" />
        </span>
      ))}
    </span>
  );
}

/** The coach. The door is the part that carries the message. */
function MiniBus({ door = 'shut', dim = false }) {
  return (
    <span
      className={cn(
        // One width on a phone, whatever the scene.
        //
        // A full-width coach filled the band, which closed the road between it
        // and the stop and made a bus an hour away look like it was standing at
        // the kerb. Shrinking only the ones drawn far off fixed that but left
        // the sizes inconsistent, so a bus at the stop looked like a different,
        // larger vehicle than the same bus approaching it.
        'relative block w-[96px] shrink rounded-[6px] bg-primary sm:w-[172px]',
        dim && 'opacity-55'
      )}
      aria-hidden
    >
      <span className="flex items-center gap-[4px] p-[6px]">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-[16px] flex-1 rounded-[2px] bg-primary-foreground/25" />
        ))}

        <span
          className={cn(
            'relative h-[16px] w-[11px] shrink-0 rounded-[2px]',
            door === 'open' && 'bg-background',
            door === 'shut' && 'bg-accent/50',
            door === 'barred' && 'bg-accent/70'
          )}
        >
          {door === 'barred' && (
            <span className="absolute left-[-3px] right-[-3px] top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-destructive" />
          )}
          {door === 'shut' && (
            <span className="absolute inset-y-[2px] left-1/2 w-px -translate-x-1/2 bg-primary/40" />
          )}
        </span>

        <span className="h-[16px] w-[19px] shrink-0 rounded-[2px] rounded-tr-[5px] bg-primary-foreground/35" />
      </span>

      <span className="relative block h-[7px] rounded-b-[6px] bg-accent/30">
        <span className="absolute bottom-[1px] left-[5px] h-[3px] w-[6px] rounded-[1px] bg-destructive/80" />
        <span className="absolute bottom-[1px] right-[5px] h-[3px] w-[7px] rounded-[1px] bg-warning" />
      </span>

      <Wheel left="24%" />
      <Wheel left="79%" />
    </span>
  );
}

/** Dashes slide only when the bus is actually moving. */
function Road({ moving, crawl, stillness }) {
  const run = moving && !stillness;
  const creeping = run && crawl;
  return (
    <div
      className="absolute inset-x-0 bottom-0 h-[8px] overflow-hidden bg-foreground/[0.18]"
      aria-hidden
    >
      <motion.div
        className="absolute left-0 top-1/2 flex w-[200%] -translate-y-1/2 gap-3"
        animate={creeping ? CRAWL_ROAD : run ? { x: ['0%', '-50%'] } : { x: '0%' }}
        transition={
          creeping
            ? CRAWL_TIMING
            : run
              ? { duration: 1.1, ease: 'linear', repeat: Infinity }
              : { duration: 0 }
        }
      >
        {Array.from({ length: 30 }).map((_, i) => (
          <span key={i} className="h-[2px] w-6 shrink-0 rounded-full bg-background/70" />
        ))}
      </motion.div>
    </div>
  );
}

function SpeedLines({ stillness, late }) {
  return (
    <div className="mb-3 flex shrink-0 flex-col gap-[5px]" aria-hidden>
      {[18, 26, 14].map((w, i) => (
        <motion.span
          key={i}
          className={cn('block h-[2px] rounded-full', late ? 'bg-warning' : 'bg-foreground/25')}
          style={{ width: w }}
          animate={stillness ? {} : { opacity: [0.2, 0.7, 0.2], x: [0, -6, 0] }}
          transition={
            stillness
              ? undefined
              : { duration: 0.9, repeat: Infinity, delay: i * 0.12, ease: 'easeInOut' }
          }
        />
      ))}
    </div>
  );
}

/**
 * The stop you are standing at.
 *
 * A late bus means a longer wait, so the queue is longer and the sign goes
 * amber. If the bus coming is full, a bar stands in front of the queue: it is
 * arriving, and they still are not getting on.
 */
function ThisStop({ late, full, waiting = 2, label, compact }) {
  const heads = late ? waiting + 1 : waiting;
  return (
    <div className="flex min-w-0 shrink items-end gap-2" aria-hidden>
      {full && <span className="mb-2 h-[3px] w-6 shrink-0 rounded-full bg-destructive" />}
      {/* On a phone, where the bus is drawn away from the stop, the queue is
          the first thing to go: the road between them is what has to survive,
          and a labelled pole still reads as a stop without anyone standing at
          it. */}
      <span className={cn('items-end gap-2', compact ? 'hidden sm:flex' : 'flex')}>
        {Array.from({ length: heads }).map((_, i) => (
          <Person key={i} h={i === 0 ? 24 : 20} tone={i % 2 ? 'primary' : 'accent'} />
        ))}
      </span>
      <StopPole alert={late} label={label} />
    </div>
  );
}

/**
 * @param scene      from `sceneFor` — { place, full, late }
 * @param atLabel    the stop the bus is standing at, when it is standing at one
 * @param hereLabel  the stop this card is about
 */
export function BusStatusScene({ scene, atLabel, hereLabel }) {
  const stillness = useReducedMotion();
  const { place, full, late } = scene;

  const travelling = place === 'travelling';
  // Only a bus actually on the road can be sitting in traffic.
  const crawling = travelling && scene.traffic;
  // Away from you: the road between the bus and your stop is the point, so the
  // two ends are pushed apart. Here or finished: one tableau, centred.
  const spread = travelling || place === 'elsewhere';

  const door = full ? 'barred' : place === 'atStop' ? 'open' : 'shut';

  return (
    <div className={BAND} aria-hidden>
      <Road moving={travelling} crawl={crawling} stillness={stillness} />

      <div
        className={cn(
          'absolute inset-x-5 bottom-[8px] flex items-end gap-3',
          spread ? 'justify-between' : 'justify-center gap-4'
        )}
      >
        <div className={cn('flex items-end', crawling ? 'gap-2 sm:gap-3' : 'gap-3')}>
          {/* Not speeding, so no speed lines — the queue says it instead. */}
          {travelling && !crawling && <SpeedLines stillness={stillness} late={late} />}

          {/* The car behind loses ground when the bus pulls away, then takes
              it back. Hidden on the narrowest screens, where the queue ahead
              already reads and the width is needed for the name plates. */}
          {crawling && (
            <motion.span
              className="hidden items-end min-[420px]:flex"
              animate={stillness ? {} : CRAWL_BEHIND}
              transition={stillness ? undefined : CRAWL_TIMING}
            >
              <Car shape="van" alt />
            </motion.span>
          )}

          <MiniBus door={door} dim={place === 'done'} />

          {/* The car ahead pulls away, and the bus closes it up. */}
          {crawling && (
            <motion.span
              className="flex items-end"
              animate={stillness ? {} : CRAWL_AHEAD}
              transition={stillness ? undefined : CRAWL_TIMING}
            >
              <Car shape="sedan" />
            </motion.span>
          )}

          {/* Parked somewhere else: draw the stop it is standing at, so it is
              plainly not the one you are reading. */}
          {place === 'elsewhere' && <StopPole label={atLabel} />}

          {/* Here, with the door open: passengers walking on, one after
              another, the queue behind them refilling as they go. */}
          {place === 'atStop' && !full && (
            <span className="relative block h-[26px] w-[44px] shrink-0" aria-hidden>
              {stillness ? (
                <span className="absolute bottom-0 left-0">
                  <Person h={26} tone="accent" />
                </span>
              ) : (
                [0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="absolute bottom-0 left-0"
                    animate={BOARDING}
                    transition={{
                      duration: BOARD_CYCLE,
                      times: BOARDING_TIMES,
                      repeat: Infinity,
                      ease: 'linear',
                      delay: (i * BOARD_CYCLE) / 3,
                    }}
                  >
                    <Person h={i === 1 ? 22 : 26} tone={i === 1 ? 'primary' : 'accent'} />
                  </motion.span>
                ))
              )}
            </span>
          )}
        </div>

        {spread ? (
          <ThisStop late={late} full={full} label={hereLabel} compact />
        ) : place === 'done' ? (
          <div className="flex min-w-0 items-end gap-2 opacity-70">
            <Person h={20} tone="primary" />
            <StopPole label={hereLabel} />
          </div>
        ) : (
          <ThisStop late={late} full={full} waiting={full ? 2 : 1} label={hereLabel} />
        )}
      </div>
    </div>
  );
}

/**
 * Where the bus is, and what else is true of it.
 *
 * Place is decided first and on its own, because it is the question being
 * asked. "Full", "late" and "in traffic" then modify that picture rather than
 * replacing it — which is the fix for a full bus still an hour away drawing as
 * though it were standing in front of you.
 *
 * Late and traffic are deliberately separate, because the engine separates
 * them: `isLate` is time this trip lost on its own, with shared congestion
 * already subtracted, while `inTraffic` is that shared congestion. A bus can
 * be crawling and not late, and the drawing should be able to say so.
 */
export function sceneFor({
  hasArrived,
  isFull,
  isHereNow,
  isDeparture,
  notDepartedYet,
  isLate,
  inTraffic,
}) {
  const place = hasArrived
    ? 'done'
    : isHereNow || isDeparture
      ? 'atStop'
      : notDepartedYet
        ? 'elsewhere'
        : 'travelling';

  return {
    place,
    full: Boolean(isFull),
    late: Boolean(isLate),
    traffic: Boolean(inTraffic),
  };
}
