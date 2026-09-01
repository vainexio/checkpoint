import { cn } from '@/lib/utils.ts';
import { formatTime } from '@/utils/time.js';

/**
 * The route as a strip of checkpoints: what has been confirmed, what was passed
 * without a tap, and what is still projected ahead. This is where the
 * checkpoint-not-coordinates idea becomes legible — you can see exactly which
 * observations the ETA is built from.
 */
export function Timeline({ stops, lastConfirmedName }) {
  return (
    <ol className="relative">
      {stops.map((stop, index) => {
        const isLandmark = stop.type === 'landmark';
        const isCurrent = stop.name === lastConfirmedName;
        const isFirst = index === 0;
        const isLast = index === stops.length - 1;

        return (
          <li key={stop.checkpointId} className="grid grid-cols-[28px_1fr_auto] items-start gap-3 py-3">
            <div className="relative flex justify-center self-stretch" aria-hidden>
              <span
                className={cn(
                  'absolute w-px bg-border',
                  isFirst ? 'top-3' : '-top-3',
                  isLast ? 'bottom-[calc(100%-0.75rem)]' : '-bottom-3'
                )}
              />
              <span
                className={cn(
                  'relative mt-1.5 h-3 w-3 rounded-full border-2 bg-background transition-shadow',
                  stop.progress === 'passed' && 'border-success bg-success',
                  stop.progress === 'skipped' && 'border-dashed border-muted-foreground',
                  stop.progress === 'pending' && 'border-border',
                  isCurrent && 'ring-4 ring-success/20'
                )}
              />
            </div>

            <div className="min-w-0">
              <div
                className={cn(
                  'flex flex-wrap items-center gap-2 font-semibold',
                  stop.progress === 'pending' && 'text-muted-foreground'
                )}
              >
                {stop.name}
                {isLandmark && (
                  <span className="rounded-full border border-border px-2 py-px text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    timing point
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[13px] text-muted-foreground">
                {stop.progress === 'passed' && 'Confirmed'}
                {stop.progress === 'skipped' && 'Passed without a confirmation'}
                {stop.progress === 'pending' &&
                  (stop.baselineMinutesFromPrevious
                    ? `${stop.baselineMinutesFromPrevious} min from previous`
                    : 'Origin')}
              </div>
            </div>

            <div className="flex flex-col items-end gap-0.5 text-right">
              <span
                className={cn(
                  'font-mono tabular text-[15px] font-medium',
                  stop.progress === 'pending' && 'text-muted-foreground'
                )}
              >
                {formatTime(stop.actualArrival ?? stop.projectedArrival ?? stop.scheduledArrival)}
              </span>
              {stop.progress === 'pending' && (
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {stop.projectedArrival ? 'est.' : 'scheduled'}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
