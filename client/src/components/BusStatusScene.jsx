import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * A small drawn scene at the top of an arrival card, showing what the bus is
 * doing rather than only saying it.
 *
 * The badges already carry the words. This is for the glance before anyone
 * reads them: a bus with its door open and people stepping on means something
 * different, instantly, from the same bus with a bar across its door.
 *
 * Three rules hold it together, all learned the hard way on the page header.
 * Everything stands on the road line, because anything drifting off it reads
 * as floating. Nothing is drawn with an alpha: the band paints itself the page
 * colour and the figures use the same opaque `scene-*` mixes the street uses,
 * so none of them turn into ghosts over a tinted card. And the width is either
 * used or given up deliberately — a moving bus is placed far from the stop it
 * is heading for, and every other scene is centred, so no variant is left
 * sitting in a corner of empty road.
 */

/* Big enough to read at a glance, small enough that nine of them still scan. */
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

function StopPole() {
  return (
    <span className="flex shrink-0 flex-col items-center" aria-hidden>
      <span className="grid h-4 w-7 place-items-center rounded-[2px] bg-primary">
        <span className="h-[3px] w-3.5 rounded-full bg-primary-foreground/70" />
      </span>
      <span className="h-[30px] w-[3px] scene-pole" />
    </span>
  );
}

/**
 * The coach. The door is the only part whose shape changes between states,
 * which is deliberate: open versus barred is the whole message.
 */
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

      {/* Sill, with the tail lamp behind and the indicator up front. */}
      <span className="relative block h-[7px] rounded-b-[6px] bg-accent/30">
        <span className="absolute bottom-[1px] left-[5px] h-[3px] w-[6px] rounded-[1px] bg-destructive/80" />
        <span className="absolute bottom-[1px] right-[5px] h-[3px] w-[7px] rounded-[1px] bg-warning" />
      </span>

      <Wheel left="24%" />
      <Wheel left="79%" />
    </span>
  );
}

/** The road everything stands on. Dashes slide only when the bus is moving. */
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

function SpeedLines({ stillness }) {
  return (
    <div className="mb-3 flex shrink-0 flex-col gap-[5px]" aria-hidden>
      {[18, 26, 14].map((w, i) => (
        <motion.span
          key={i}
          className="block h-[2px] rounded-full bg-foreground/25"
          style={{ width: w }}
          animate={stillness ? {} : { opacity: [0.15, 0.6, 0.15], x: [0, -6, 0] }}
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
 * @param variant  waiting | boarding | full | enroute | arrived
 */
export function BusStatusScene({ variant }) {
  const stillness = useReducedMotion();
  const moving = variant === 'enroute';

  const door = variant === 'boarding' ? 'open' : variant === 'full' ? 'barred' : 'shut';

  return (
    <div className={BAND} aria-hidden>
      <Road moving={moving} stillness={stillness} />

      {/*
        * A bus still on the road is drawn far from the stop it is heading for,
        * so the gap between them is the journey. Every other state has the bus
        * already at the kerb, so the whole tableau is centred instead of
        * stranded at one end.
        */}
      <div
        className={cn(
          'absolute inset-x-5 bottom-[8px] flex items-end gap-3',
          moving ? 'justify-between' : 'justify-center gap-4'
        )}
      >
        <div className="flex items-end gap-3">
          {moving && <SpeedLines stillness={stillness} />}
          <MiniBus door={door} dim={variant === 'arrived'} />

          {/* Boarding: someone stepping up to the open door. */}
          {variant === 'boarding' && (
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

          {/* Full: a bar, and passengers left standing behind it. */}
          {variant === 'full' && (
            <div className="flex items-end gap-2">
              <span className="mb-2 h-[3px] w-6 shrink-0 rounded-full bg-destructive" />
              <Person h={24} tone="primary" />
              <Person h={21} tone="accent" />
            </div>
          )}
        </div>

        {/* The stop: where it is going if it is moving, where it is if not. */}
        <div className={cn('flex items-end gap-2', variant === 'arrived' && 'opacity-70')}>
          {variant === 'boarding' && <Person h={22} tone="primary" />}
          {(variant === 'waiting' || variant === 'enroute') && (
            <>
              <Person h={24} tone="accent" />
              <Person h={20} tone="primary" />
            </>
          )}
          <StopPole />
        </div>
      </div>
    </div>
  );
}

/**
 * Which scene a row gets.
 *
 * Order matters and encodes what a passenger most needs to know. "Full" wins
 * over "boarding" because a bus you cannot get on is not boarding, whatever
 * else is true of it. And standing at *this* stop beats "has not left yet",
 * because nearly every departure row is both at once — reading those as merely
 * waiting meant the boarding scene never appeared at all.
 */
export function sceneFor({ hasArrived, isFull, isHereNow, isDeparture, notDepartedYet }) {
  if (hasArrived) return 'arrived';
  if (isFull) return 'full';
  if (isHereNow || isDeparture) return 'boarding';
  if (notDepartedYet) return 'waiting';
  return 'enroute';
}
