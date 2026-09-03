import { Bus } from 'lucide-react';
import { cn } from '@/lib/utils.ts';
import { formatTime } from '@/utils/time.js';

/**
 * The route as a strip of checkpoints: what has been confirmed, what was passed
 * without a tap, and what is still projected ahead. This is where the
 * checkpoint-not-coordinates idea becomes legible — you can see exactly which
 * observations the ETA is built from.
 *
 * The bus marker sits on a checkpoint only while the conductor has confirmed
 * reaching it and not yet confirmed leaving — at a station that means the doors
 * may still be open. Once they report pulling out, the marker moves onto the
 * line between two points, because that is all a checkpoint system can honestly
 * say about a bus in motion.
 */
export function Timeline({ stops, isArrived = false, position = 'between' }) {
  const lastPassed = stops.reduce((acc, s, i) => (s.progress === 'passed' ? i : acc), -1);

  return (
    <ol className="relative">
      {stops.map((stop, index) => {
        const isLandmark = stop.type === 'landmark';
        const isFirst = index === 0;
        const isLast = index === stops.length - 1;

        // The leg into this checkpoint is the one the bus is currently on.
        const busInbound =
          !isArrived &&
          position === 'between' &&
          lastPassed >= 0 &&
          index === lastPassed + 1 &&
          stop.progress === 'pending';
        // Standing at this stop right now, doors possibly still open.
        const busHere = !isArrived && position === 'at_stop' && index === lastPassed;

        return (
          <li
            key={stop.checkpointId}
            className="grid grid-cols-[24px_1fr_auto] items-start gap-2 py-3 sm:grid-cols-[28px_1fr_auto] sm:gap-3"
          >
            <div className="relative flex justify-center self-stretch" aria-hidden>
              <span
                className={cn(
                  'absolute w-px bg-border',
                  isFirst ? 'top-3' : '-top-3',
                  isLast ? 'bottom-[calc(100%-0.75rem)]' : '-bottom-3'
                )}
              />

              {/*
                * The bus is on the leg *into* this stop, so its marker belongs on
                * the line between the two rows — centred on the boundary rather
                * than nudged up by a fixed amount. The old fixed offset assumed a
                * row height, and the moment a stop name or its note wrapped to two
                * lines on a narrow screen the marker drifted into the text above.
                */}
              {busInbound && (
                <span className="absolute -top-3 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full bg-success text-white shadow-sm ring-2 ring-background">
                  <Bus className="h-3 w-3" />
                </span>
              )}

              {busHere ? (
                <span className="relative mt-0.5 grid h-5 w-5 place-items-center rounded-full bg-success text-white shadow-sm ring-2 ring-background">
                  <Bus className="h-3 w-3" />
                </span>
              ) : (
                <span
                  className={cn(
                    'relative mt-1.5 h-3 w-3 rounded-full border-2 bg-card',
                    stop.progress === 'passed' && 'border-success bg-success',
                    stop.progress === 'skipped' && 'border-dashed border-muted-foreground',
                    stop.progress === 'pending' && 'border-border'
                  )}
                />
              )}
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
                {stop.progress === 'passed' &&
                  (busHere
                    ? 'Bus is here now — boarding'
                    : index === lastPassed && !isArrived
                      ? 'Confirmed — bus has since left here'
                      : 'Confirmed')}
                {stop.progress === 'skipped' && 'Passed without a confirmation'}
                {stop.progress === 'pending' &&
                  (busInbound
                    ? 'On the way here now'
                    : stop.baselineMinutesFromPrevious
                      ? `${stop.baselineMinutesFromPrevious} min from previous`
                      : 'Origin')}
              </div>
            </div>

            <div className="flex flex-col items-end gap-0.5 text-right">
              <span
                className={cn(
                  'tabular text-[15px] font-semibold',
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
