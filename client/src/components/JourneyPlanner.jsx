import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Ban, Crosshair, Footprints, Loader2, MapPin, Route } from 'lucide-react';
import { searchJourneys } from '@/api/publicApi.js';
import { useNow } from '@/hooks/usePolling.js';
import { StopPicker } from '@/components/StopPicker.jsx';
import { StatusBadge } from '@/components/StatusBadge.jsx';
import { SeatBadge } from '@/components/SeatPicker.jsx';
import { ArrivalCountdown } from '@/components/ArrivalCountdown.jsx';
import { Card, CardContent } from '@/components/ui/card.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { directionsUrl, walkMinutes } from '@/utils/directions.js';
import { formatDuration, formatTime } from '@/utils/time.js';
import { cn } from '@/lib/utils.ts';

const REFRESH_MS = 30000;

/**
 * "I want to get to Lipa" — the question, asked the way a passenger has it.
 *
 * A stop board answers "what comes here", which is only useful once you have
 * already worked out where to stand. On a network where routes overlap that is
 * the genuinely hard part: three different buses pass Santo Tomas and only two
 * of them are any use to you. So the destination is the required field and the
 * boarding stop is the *answer*, not another thing to know in advance.
 */
export function JourneyPlanner({ stations, you, onRequestLocation, locating }) {
  const [from, setFrom] = useState(null); // null = wherever I am
  const [to, setTo] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const now = useNow(15000);

  const run = useCallback(async () => {
    if (!to) return;
    setLoading(true);
    setError(null);
    try {
      setResult(
        await searchJourneys({ to: to.id, from: from?.id ?? null, here: from ? null : you })
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [to, from, you]);

  // Search as soon as there is a destination, and keep it warm — a list of
  // departure times that silently goes stale is worse than no list at all.
  useEffect(() => {
    if (!to) {
      setResult(null);
      return;
    }
    run();
    const id = setInterval(run, REFRESH_MS);
    return () => clearInterval(id);
  }, [run, to]);

  return (
    <Card className="mb-6 border-primary/25 tint-primary">
      <CardContent className="p-5">
        <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          <Route className="h-3.5 w-3.5" />
          Going somewhere?
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">From</label>
            <StopPicker
              stations={stations}
              value={from}
              onChange={setFrom}
              placeholder="Anywhere near me"
              extraOption={{
                label: you ? 'Anywhere near me' : 'Use my location',
                icon: locating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Crosshair className="h-4 w-4 text-primary" />
                ),
                onSelect: () => {
                  setFrom(null);
                  if (!you) onRequestLocation();
                },
              }}
            />
          </div>

          <div className="hidden items-end pb-3 sm:flex">
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">To</label>
            <StopPicker
              stations={stations}
              value={to}
              onChange={setTo}
              placeholder="Where are you going?"
            />
          </div>
        </div>

        {!from && !you && (
          <p className="mt-3 text-[13px] text-muted-foreground">
            Without your location this shows every stop on the way. Pick a starting stop, or share
            your location, to narrow it down.
          </p>
        )}

        {error && <p className="mt-3 text-[13px] text-destructive">{error}</p>}

        {loading && !result && (
          <div className="mt-5 space-y-3">
            <Skeleton className="h-[130px] rounded-xl" />
            <Skeleton className="h-[130px] rounded-xl" />
          </div>
        )}

        {result && <Results result={result} you={you} now={now} />}
      </CardContent>
    </Card>
  );
}

function Results({ result, you, now }) {
  if (!result.options.length) {
    return (
      <div className="mt-5 rounded-xl border border-dashed border-border bg-background p-5 text-sm text-muted-foreground">
        <p className="font-semibold text-foreground">
          Nothing running to {result.destination.name} right now.
        </p>
        <p className="mt-1">
          {result.origin
            ? `No bus on the road passes ${result.origin.name} before ${result.destination.name}.`
            : result.from
              ? `No bus heading there stops within ${result.radiusKm} km of you.`
              : 'No trip on the road is heading there.'}{' '}
          Buses that have already passed your stop are not listed, since you cannot catch them.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {result.options.length} bus{result.options.length === 1 ? '' : 'es'} to{' '}
        {result.destination.name}
      </h3>
      <div className="space-y-3">
        {result.options.map((o) => (
          <OptionRow key={o.tripId} option={o} you={you} now={now} />
        ))}
      </div>
    </div>
  );
}

function OptionRow({ option, you, now }) {
  const isFull = option.load === 'full';
  const walk = walkMinutes(option.boardAt.distanceKm);
  const directions = directionsUrl(option.boardAt.location, you);

  return (
    <Card
      className={cn(
        // A white result sitting inside the tinted planner card, so the two
        // layers stay distinguishable.
        'overflow-hidden bg-card',
        option.isHereNow && 'border-success/60 tint-success',
        isFull && 'border-destructive/40 opacity-90'
      )}
    >
      {isFull && (
        <div className="flex items-center gap-2 bg-destructive/10 px-4 py-1.5 text-[12px] font-bold text-destructive">
          <Ban className="h-3.5 w-3.5 shrink-0" />
          Not picking up passengers — do not wait for this one
        </div>
      )}

      <CardContent className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              {option.bus && (
                <span className="inline-flex items-center rounded-lg border-2 border-foreground/15 bg-muted/60 px-2 py-0.5 font-mono text-[15px] font-bold tracking-[0.08em]">
                  {option.bus.plateNumber}
                </span>
              )}
              <span className="text-[15px] font-bold">{option.route}</span>
            </div>

            {/* The answer to the question actually asked: which curb. */}
            <div className="flex items-start gap-2 text-[15px]">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                <span className="text-muted-foreground">Board at </span>
                <span className="font-bold">{option.boardAt.name}</span>
                {option.boardAt.distanceKm != null && (
                  <span className="text-muted-foreground">
                    {' '}
                    · {option.boardAt.distanceKm} km
                    {walk ? `, about ${walk} min walk` : ' away'}
                  </span>
                )}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge
                status={option.status}
                isStale={option.isStale}
                varianceMinutes={option.varianceMinutes}
                conditionsAllowanceMinutes={option.conditionsAllowanceMinutes}
              />
              <SeatBadge
                load={option.load}
                reportedAtName={option.loadReportedAtName}
                reportedAt={option.loadReportedAt}
              />
            </div>

            <div className="mt-2 text-[13px] text-muted-foreground">
              Gets you there {formatTime(option.arriveTime)}
              {option.rideMinutes != null && <> · {formatDuration(option.rideMinutes)} ride</>}
              {option.stopsBetween > 0 && (
                <>
                  {' '}
                  · {option.stopsBetween} stop{option.stopsBetween === 1 ? '' : 's'} on the way
                </>
              )}
            </div>

            {/* Someone standing nearer a different curb should not be sent to
                this one just because it was closest to the phone's fix. */}
            {option.alsoBoardableAt.length > 0 && (
              <div className="mt-1.5 text-[13px] text-muted-foreground">
                Also stops at{' '}
                {option.alsoBoardableAt.map((a, i) => (
                  <span key={a.id}>
                    {i > 0 && ', '}
                    <span className="font-medium text-foreground">{a.name}</span>
                    {a.distanceKm != null && ` (${a.distanceKm} km)`}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to={`/stations/${option.boardAt.id}`}>See this stop</Link>
              </Button>
              {directions && (
                <Button variant="outline" size="sm" asChild>
                  <a href={directions} target="_blank" rel="noreferrer noopener">
                    <Footprints className="mr-1.5 h-3.5 w-3.5" />
                    Walk there
                  </a>
                </Button>
              )}
            </div>
          </div>

          <ArrivalCountdown
            className="shrink-0 sm:min-w-[130px]"
            time={option.boardTime}
            now={now}
            kind={option.boardKind}
            isHereNow={option.isHereNow}
            isStale={option.isStale}
          />
        </div>
      </CardContent>
    </Card>
  );
}
