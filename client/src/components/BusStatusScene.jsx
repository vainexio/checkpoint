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
function StopPole({ alert = false }) {
  return (
    <span className="flex shrink-0 flex-col items-center" aria-hidden>
      <span
        className={cn('grid h-4 w-7 place-items-center rounded-[2px]', alert ? 'bg-warning' : 'bg-primary')}
      >
        <span
          className={cn(
            'h-[3px] w-3.5 rounded-full',
            alert ? 'bg-foreground/50' : 'bg-primary-foreground/70'
          )}
        />
      </span>
      <span className="h-[30px] w-[3px] scene-pole" />
    </span>
  );
}

/** The coach. The door is the part that carries the message. */
function MiniBus({ door = 'shut', dim = false }) {
  return (
    <span
      className={cn(
        'relative block w-[148px] shrink-0 rounded-[6px] bg-primary sm:w-[172px]',
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
function Road({ moving, stillness }) {
  const run = moving && !stillness;
  return (
    <div
      className="absolute inset-x-0 bottom-0 h-[8px] overflow-hidden bg-foreground/[0.18]"
      aria-hidden
    >
      <motion.div
        className="absolute left-0 top-1/2 flex w-[200%] -translate-y-1/2 gap-3"
        animate={run ? { x: ['0%', '-50%'] } : { x: '0%' }}
        transition={run ? { duration: 1.1, ease: 'linear', repeat: Infinity } : { duration: 0 }}
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
function ThisStop({ late, full, waiting = 2 }) {
  const heads = late ? waiting + 1 : waiting;
  return (
    <div className="flex shrink-0 items-end gap-2" aria-hidden>
      {full && <span className="mb-2 h-[3px] w-6 shrink-0 rounded-full bg-destructive" />}
      {Array.from({ length: heads }).map((_, i) => (
        <Person key={i} h={i === 0 ? 24 : 20} tone={i % 2 ? 'primary' : 'accent'} />
      ))}
      <StopPole alert={late} />
    </div>
  );
}

/**
 * @param scene  from `sceneFor` — { place, full, late }
 */
export function BusStatusScene({ scene }) {
  const stillness = useReducedMotion();
  const { place, full, late } = scene;

  const travelling = place === 'travelling';
  // Away from you: the road between the bus and your stop is the point, so the
  // two ends are pushed apart. Here or finished: one tableau, centred.
  const spread = travelling || place === 'elsewhere';

  const door = full ? 'barred' : place === 'atStop' ? 'open' : 'shut';

  return (
    <div className={BAND} aria-hidden>
      <Road moving={travelling} stillness={stillness} />

      <div
        className={cn(
          'absolute inset-x-5 bottom-[8px] flex items-end gap-3',
          spread ? 'justify-between' : 'justify-center gap-4'
        )}
      >
        <div className="flex items-end gap-3">
          {travelling && <SpeedLines stillness={stillness} late={late} />}
          <MiniBus door={door} dim={place === 'done'} />

          {/* Parked somewhere else: draw the stop it is standing at, so it is
              plainly not the one you are reading. */}
          {place === 'elsewhere' && <StopPole />}

          {/* Here, with room: someone stepping up to the open door. */}
          {place === 'atStop' && !full && (
            <motion.span
              className="flex items-end"
              animate={stillness ? {} : { x: [0, -7, 0] }}
              transition={
                stillness ? undefined : { duration: 1.7, repeat: Infinity, ease: 'easeInOut' }
              }
            >
              <Person h={26} tone="accent" />
            </motion.span>
          )}
        </div>

        {spread ? (
          <ThisStop late={late} full={full} />
        ) : place === 'done' ? (
          <div className="flex items-end gap-2 opacity-70">
            <Person h={20} tone="primary" />
            <StopPole />
          </div>
        ) : (
          <ThisStop late={late} full={full} waiting={full ? 2 : 1} />
        )}
      </div>
    </div>
  );
}

/**
 * Where the bus is, and what else is true of it.
 *
 * Place is decided first and on its own, because it is the question being
 * asked. "Full" and "late" then modify that picture rather than replacing it —
 * which is the fix for a full bus still an hour away drawing as though it were
 * standing in front of you.
 */
export function sceneFor({
  hasArrived,
  isFull,
  isHereNow,
  isDeparture,
  notDepartedYet,
  isLate,
}) {
  const place = hasArrived
    ? 'done'
    : isHereNow || isDeparture
      ? 'atStop'
      : notDepartedYet
        ? 'elsewhere'
        : 'travelling';

  return { place, full: Boolean(isFull), late: Boolean(isLate) };
}
