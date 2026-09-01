import { Bus } from 'lucide-react';
import { cn } from '@/lib/utils.ts';
import { formatTime } from '@/utils/time.js';

/**
 * The whole route as one horizontal strip, with the stop being viewed marked
 * and the bus drawn *between* two points rather than on one.
 *
 * That distinction is the whole system in miniature. A checkpoint confirmation
 * tells you a bus went past a place at a time — it does not tell you the bus is
 * still there. Putting the marker on a dot would claim the bus is sitting at
 * Tarlac when it left forty minutes ago, so the marker rides the leg it is
 * actually driving.
 */
export function JourneyStrip({ journey }) {
  if (!journey?.length) return null;

  return (
    <div className="overflow-x-auto pb-1">
      <ol className="flex min-w-max items-start gap-0">
        {journey.map((stop, i) => {
          const done = stop.progress === 'passed' || stop.progress === 'skipped';
          const isLast = i === journey.length - 1;
          // The bus is on the leg leading into the next unconfirmed point.
          const busOnLegAfter = !isLast && journey[i + 1].isHeadingHere;

          return (
            <li key={`${stop.name}-${i}`} className="flex items-start">
              <div className="flex w-[86px] flex-col items-center text-center">
                <span className="relative flex h-4 items-center">
                  <span
                    className={cn(
                      'h-3 w-3 rounded-full border-2 bg-background',
                      done && 'border-success bg-success',
                      !done && 'border-border',
                      stop.isYourStop && 'h-4 w-4 border-primary bg-primary ring-4 ring-primary/20'
                    )}
                  />
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

                <span className="mt-0.5 font-mono tabular text-[10px] text-muted-foreground">
                  {formatTime(stop.eta)}
                </span>

                {stop.isLastConfirmed && (
                  <span className="mt-1 rounded-full bg-success/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-success">
                    passed
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
