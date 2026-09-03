import { Bus } from 'lucide-react';
import { cn } from '@/lib/utils.ts';
import { formatTime } from '@/utils/time.js';

/**
 * The whole route as one horizontal strip, with the stop being viewed marked
 * and the bus shown in one of two genuinely different situations.
 *
 * A bus standing at a stop with its doors open and a bus already on the highway
 * mean opposite things to someone waiting there — run, or settle in. So the
 * marker sits *on* a stop only while the conductor has confirmed arriving and
 * not yet confirmed leaving; the moment they report pulling out, it moves onto
 * the leg the bus is actually driving.
 */
export function JourneyStrip({ journey }) {
  if (!journey?.length) return null;

  return (
    // pt-1 gives the bus badge, which is taller than a plain dot, room inside
    // the horizontal scroll container instead of being clipped by it.
    <div className="overflow-x-auto pb-1 pt-1">
      <ol className="flex min-w-max items-start gap-0">
        {journey.map((stop, i) => {
          const done = stop.progress === 'passed' || stop.progress === 'skipped';
          const isLast = i === journey.length - 1;
          // The bus is on the leg leading into the next unconfirmed point.
          const busOnLegAfter = !isLast && journey[i + 1].isHeadingHere;
          const busAtThisStop = stop.isBusHere;

          return (
            <li key={`${stop.name}-${i}`} className="flex items-start">
              <div className="flex w-[86px] flex-col items-center text-center">
                <span className="relative flex h-4 items-center">
                  {busAtThisStop ? (
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-success text-white shadow-sm ring-2 ring-background">
                      <Bus className="h-3 w-3" />
                    </span>
                  ) : (
                    <span
                      className={cn(
                        'h-3 w-3 rounded-full border-2 bg-card',
                        done && 'border-success bg-success',
                        !done && 'border-border',
                        stop.isYourStop && 'h-4 w-4 border-primary bg-primary ring-4 ring-primary/20'
                      )}
                    />
                  )}
                </span>

                <span
                  className={cn(
                    'mt-1.5 line-clamp-2 text-[11px] leading-tight',
                    stop.isYourStop ? 'font-bold text-primary' : 'text-muted-foreground',
                    stop.type === 'landmark' && !stop.isYourStop && 'italic'
                  )}
                >
                  {stop.name}
                </span>

                <span className="mt-0.5 tabular text-[10px] font-medium text-muted-foreground">
                  {formatTime(stop.eta)}
                </span>

                {busAtThisStop && (
                  <span className="mt-1 rounded-full bg-success px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-white">
                    boarding
                  </span>
                )}
                {stop.isLastConfirmed && !busAtThisStop && (
                  <span className="mt-1 rounded-full bg-success/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-success">
                    left
                  </span>
                )}
                {stop.isYourStop && (
                  <span className="mt-1 rounded-full bg-primary/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-primary">
                    this stop
                  </span>
                )}
              </div>

              {!isLast && (
                <span className="relative mt-[7px] flex h-4 w-10 shrink-0 items-center justify-center">
                  <span
                    className={cn(
                      'absolute inset-x-0 h-0.5 rounded',
                      journey[i + 1].progress === 'passed' ? 'bg-success' : 'bg-border'
                    )}
                  />
                  {busOnLegAfter && (
                    <span
                      className="relative grid h-5 w-5 place-items-center rounded-full bg-success text-white shadow-sm ring-2 ring-background"
                      title="Somewhere along here"
                    >
                      <Bus className="h-3 w-3" />
                    </span>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
