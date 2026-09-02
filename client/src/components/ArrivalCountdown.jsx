import { cn } from '@/lib/utils.ts';
import { formatDuration, formatTime, relativeMinutes } from '@/utils/time.js';

/**
 * How long until the bus gets here — set as the headline, with the clock time
 * demoted beneath it.
 *
 * The wall clock was the biggest thing on the board and it made every reader do
 * arithmetic: see 3:42, find the current time, subtract. Someone deciding
 * whether to buy a drink or run for the curb wants the answer, not the inputs.
 * So the wait leads and the time follows, because the time is still what you
 * check a printed schedule against and what you tell someone over the phone.
 *
 * `kind` decides the sentence, not the styling: an arrival counts down, a
 * departure counts down to a different verb, and a bus that has already got in
 * counts up.
 */
/**
 * How far past its estimate a bus can drift before the countdown stops
 * pretending. Short enough to catch a bus that quietly went by, long enough to
 * survive a conductor who is a few minutes late tapping.
 */
const STALE_OVERDUE_MINUTES = 10;

export function ArrivalCountdown({
  time,
  now = new Date(),
  kind = 'arrival',
  isHereNow = false,
  isStale = false,
  className,
}) {
  const minutes = relativeMinutes(time, now);
  const hasArrived = kind === 'arrived';

  /**
   * Past its estimate, with nobody confirming it anywhere.
   *
   * "Due now" is a promise, and repeating it over a bus that stopped reporting
   * an hour ago is the worst thing this screen can do: it holds someone at a
   * curb for a bus that may have driven past already. Once the estimate is both
   * stale and well overdue, the count flips to counting *up* — which is not an
   * answer, but is at least a true statement of what we know.
   */
  const overdue = minutes !== null && minutes < 0 ? -minutes : 0;
  const lostIt = isStale && !hasArrived && !isHereNow && overdue > STALE_OVERDUE_MINUTES;

  // A bus standing at your stop is not a countdown — it is an instruction.
  const headline = isHereNow
    ? 'Boarding'
    : minutes === null
      ? '—'
      : hasArrived || lostIt
        ? formatDuration(minutes)
        : minutes <= 0
          ? 'Due now'
          : formatDuration(minutes);

  const label = isHereNow
    ? 'At this stop now'
    : hasArrived
      ? 'Arrived'
      : lostIt
        ? 'Overdue by'
        : kind === 'departure'
          ? 'Departs in'
          : minutes !== null && minutes <= 0
            ? 'Expected'
            : 'Arrives in';

  const tone = isHereNow
    ? 'text-success'
    : hasArrived
      ? 'text-muted-foreground'
      : isStale
        ? 'text-muted-foreground'
        : // Close enough that it changes what you do in the next minute.
          minutes !== null && minutes <= 10
          ? 'text-primary'
          : 'text-foreground';

  return (
    <div className={cn('text-left sm:text-right', className)}>
      <div
        className={cn(
          'mb-1 text-[11px] font-bold uppercase tracking-[0.12em]',
          isHereNow ? 'text-success' : 'text-muted-foreground'
        )}
      >
        {label}
      </div>

      <div
        className={cn(
          'font-mono tabular text-[32px] font-bold leading-none tracking-tight sm:text-[38px]',
          tone
        )}
      >
        {headline}
        {hasArrived && minutes !== null && (
          <span className="ml-1.5 text-[15px] font-semibold tracking-normal">ago</span>
        )}
      </div>

      {/* Still shown, just no longer shouted: this is the number you match
          against a printed timetable or read out to someone meeting you. */}
      <div className="mt-1.5 font-mono text-[15px] font-semibold tabular text-muted-foreground">
        {formatTime(time)}
      </div>

      {isStale && !isHereNow && (
        <div className="mt-0.5 text-[12px] font-medium text-muted-foreground">
          {lostIt ? 'may have passed' : 'rough estimate'}
        </div>
      )}
    </div>
  );
}
