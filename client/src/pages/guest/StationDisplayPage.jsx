import { useLayoutEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Ban, Bus } from 'lucide-react';
import { usePolling, useNow } from '@/hooks/usePolling.js';
import { fetchStationBoard } from '@/api/publicApi.js';
import { loadLevel } from '@/components/SeatPicker.jsx';
import { cn } from '@/lib/utils.ts';
import { formatCountdown, formatElapsed, formatTime, relativeMinutes } from '@/utils/time.js';

/**
 * The wall screen at a terminal.
 *
 * A different product from the phone board, despite the same data. Nobody
 * touches this: it hangs above a concourse, is read from several metres away,
 * and has to work through every bus on its own. So it carries only what can be
 * acted on at that distance — when, which bus, and whether you can board —
 * and pages through the list rather than scrolling, because a moving board is
 * hard to read and people arrive mid-cycle.
 *
 * Open with ?dark=1 for a dark hall, and &rows=N to override the fit.
 */

// Enough for the eye to finish a page before it turns.
const PAGE_SECONDS = 9;
const ROW_HEIGHT = 104;

export default function StationDisplayPage() {
  const { stationId } = useParams();
  const [params] = useSearchParams();
  const dark = params.get('dark') === '1';

  const now = useNow(1000);
  const { data } = usePolling(() => fetchStationBoard(stationId), {
    intervalMs: 15000,
    deps: [stationId],
  });

  const arrivals = data?.arrivals ?? [];

  const listRef = useRef(null);
  const [perPage, setPerPage] = useState(Number(params.get('rows')) || 6);

  // Fit as many rows as the screen actually has, rather than assuming a size.
  useLayoutEffect(() => {
    if (params.get('rows')) return undefined;

    const measure = () => {
      const h = listRef.current?.clientHeight ?? 0;
      if (h) setPerPage(Math.max(1, Math.floor(h / ROW_HEIGHT)));
    };

    measure();
    const observer = new ResizeObserver(measure);
    if (listRef.current) observer.observe(listRef.current);
    return () => observer.disconnect();
  }, [params]);

  const pageCount = Math.max(1, Math.ceil(arrivals.length / perPage));

  /**
   * Which page to show is derived from the clock rather than advanced by an
   * interval. A screen like this runs for weeks unattended, and an interval can
   * drift, be throttled while the tab is backgrounded, or be lost across a
   * re-render. Reading the page off the wall clock cannot get stuck: whatever
   * happens, the next tick lands on the right page.
   */
  const page =
    pageCount > 1 ? Math.floor(now.getTime() / (PAGE_SECONDS * 1000)) % pageCount : 0;

  const visible = arrivals.slice(page * perPage, page * perPage + perPage);

  return (
    <div className={cn('h-[100dvh] overflow-hidden', dark && 'dark')}>
      <div className="flex h-full flex-col bg-background text-foreground">
        {/* ------------------------------------------------------- header */}
        <header className="flex shrink-0 items-center justify-between gap-6 border-b-2 border-border px-8 py-5">
          <div className="min-w-0">
            <div className="text-[13px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Arrivals
            </div>
            <h1 className="truncate text-[42px] font-black leading-tight tracking-tight">
              {data?.station?.name ?? '—'}
            </h1>
          </div>

          <div className="shrink-0 text-right">
            <div className="font-mono tabular text-[46px] font-bold leading-none">
              {formatTime(now)}
            </div>
            <div className="mt-1 flex items-center justify-end gap-2 text-[13px] text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              Live · Manila time
            </div>
          </div>
        </header>

        {/* -------------------------------------------------------- rows */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-hidden px-8">
          {arrivals.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[28px] font-bold text-muted-foreground">
              No buses currently heading here
            </div>
          ) : (
            visible.map((a) => <DisplayRow key={a.tripId} arrival={a} now={now} />)
          )}
        </div>

        {/* ------------------------------------------------------ footer */}
        <footer className="flex shrink-0 items-center justify-between border-t border-border px-8 py-3 text-[13px] text-muted-foreground">
          <span>Times update when a conductor confirms a checkpoint · not GPS tracked</span>
          {pageCount > 1 && (
            <span className="flex items-center gap-2">
              {Array.from({ length: pageCount }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-2 w-2 rounded-full transition-colors',
                    i === page ? 'bg-foreground' : 'bg-border'
                  )}
                />
              ))}
              <span className="ml-1 font-mono">
                {page + 1}/{pageCount}
              </span>
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}

/**
 * One line, sized for distance. Four things only: when, which bus, where it
 * has got to, and whether you can board it.
 */
function DisplayRow({ arrival, now }) {
  const isFull = arrival.load === 'full';
  const seats = loadLevel(arrival.load);
  const minutesAway = relativeMinutes(arrival.boardTime, now);

  // The same trip is a departure at its origin and an arrival everywhere else.
  const kind =
    arrival.boardKind === 'departure'
      ? { label: 'Departs', tone: 'text-primary' }
      : arrival.boardKind === 'arrived'
        ? { label: 'Arrived', tone: 'text-muted-foreground' }
        : { label: 'Arrives', tone: 'text-muted-foreground' };

  return (
    <div
      className={cn(
        'grid grid-cols-[210px_1fr_auto] items-center gap-6 border-b border-border py-4',
        isFull && 'opacity-70',
        arrival.boardKind === 'arrived' && 'opacity-60'
      )}
      style={{ height: ROW_HEIGHT }}
    >
      {/* The number the screen exists for, and what kind of number it is. */}
      <div>
        <div className={cn('text-[13px] font-bold uppercase tracking-[0.16em]', kind.tone)}>
          {kind.label}
        </div>
        <div
          className={cn(
            'mt-0.5 font-mono tabular text-[40px] font-bold leading-none tracking-tight',
            arrival.isHereNow && 'text-success',
            (arrival.isStale || arrival.boardKind !== 'arrival') &&
              !arrival.isHereNow &&
              'text-muted-foreground'
          )}
        >
          {formatTime(arrival.boardTime)}
        </div>
        <div className="mt-1 text-[15px] font-semibold text-muted-foreground">
          {arrival.isHereNow
            ? 'At the stand'
            : arrival.boardKind === 'arrived'
              ? 'On the stand'
              : arrival.isStale
                ? 'estimate'
                : minutesAway > 1
                  ? formatCountdown(arrival.boardTime, now)
                  : arrival.boardKind === 'departure'
                    ? 'boarding'
                    : 'arriving'}
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex items-baseline gap-4">
          <span className="truncate text-[30px] font-extrabold tracking-tight">
            {arrival.route}
          </span>
          <span className="shrink-0 rounded-md border-2 border-foreground/20 px-2.5 py-0.5 font-mono text-[19px] font-bold">
            {arrival.bus?.plateNumber}
          </span>
        </div>
        <div className="mt-1 truncate text-[17px] text-muted-foreground">
          {arrival.isHereNow ? (
            <span className="font-bold text-success">At this stop — boarding</span>
          ) : arrival.boardKind === 'arrived' ? (
            <>Completed from {arrival.origin}</>
          ) : arrival.boardKind === 'departure' ? (
            <>To {arrival.destination} · now boarding here</>
          ) : arrival.isStale ? (
            <>No update in {formatElapsed(arrival.minutesSinceLastConfirm)}</>
          ) : arrival.position === 'at_stop' ? (
            <>At {arrival.lastConfirmedCheckpoint?.name}</>
          ) : (
            <>
              Past {arrival.lastConfirmedCheckpoint?.name}
              {arrival.nextCheckpoint && <> · next {arrival.nextCheckpoint.name}</>}
            </>
          )}
        </div>
      </div>

      {/* Can you board it? The only other thing worth the space. */}
      <div className="shrink-0 text-right">
        {isFull ? (
          <span className="inline-flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-[19px] font-bold text-destructive-foreground">
            <Ban className="h-5 w-5" />
            FULL
          </span>
        ) : seats ? (
          <span
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[19px] font-bold',
              seats.value === 'seats'
                ? 'bg-success/15 text-success'
                : 'bg-warning/20 text-warning-strong'
            )}
          >
            <Bus className="h-5 w-5" />
            {seats.short}
          </span>
        ) : (
          <span className="text-[17px] font-semibold text-muted-foreground">
            {arrival.boardKind === 'arrived'
              ? 'Arrived'
              : arrival.isStale
                ? 'Unconfirmed'
                : arrival.status === 'delayed'
                  ? 'Delayed'
                  : ''}
          </span>
        )}
      </div>
    </div>
  );
}
