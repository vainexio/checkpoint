import { cn } from '@/lib/utils.ts';
import { formatTime } from '@/utils/time.js';

/**
 * The whole route as one horizontal strip, with the bus's last confirmed
 * position and the stop being viewed both marked.
 *
 * This exists for the passenger who does not know the area. A list of place
 * names means nothing if you have never heard of them; seeing that the bus is
 * two dots to the left of you, and that it carries on to three more places
 * after you, answers "is this my bus" without any local knowledge.
 */
export function JourneyStrip({ journey }) {
  if (!journey?.length) return null;

  return (
    <div className="overflow-x-auto pb-1">
      <ol className="flex min-w-max items-start gap-0">
        {journey.map((stop, i) => {
          const done = stop.progress === 'passed' || stop.progress === 'skipped';
          const isLast = i === journey.length - 1;

          return (
            <li key={`${stop.name}-${i}`} className="flex items-start">
              <div className="flex w-[86px] flex-col items-center text-center">
                <span className="relative flex h-4 items-center">
                  <span
                    className={cn(
                      'h-3 w-3 rounded-full border-2 bg-background',
                      done && 'border-success bg-success',
                      !done && 'border-border',
                      stop.isCurrentPosition && 'ring-4 ring-success/25',
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

                {stop.isCurrentPosition && (
                  <span className="mt-1 rounded-full bg-success/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-success">
                    bus is here
                  </span>
                )}
                {stop.isYourStop && (
                  <span className="mt-1 rounded-full bg-primary/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-primary">
                    this stop
                  </span>
                )}
              </div>

              {!isLast && (
                <span
                  className={cn(
                    'mt-[7px] h-0.5 w-3 shrink-0 rounded',
                    journey[i + 1].progress === 'passed' ? 'bg-success' : 'bg-border'
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
