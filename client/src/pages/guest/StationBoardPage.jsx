import { Link, useParams } from 'react-router-dom';
import { AlertCircle, AlertTriangle, ArrowLeft, MapPin } from 'lucide-react';
import { usePolling, useNow } from '@/hooks/usePolling.js';
import { fetchStationBoard } from '@/api/publicApi.js';
import { StatusBadge } from '@/components/StatusBadge.jsx';
import { PageHeader, LiveIndicator } from '@/components/layout/AppLayout.jsx';
import { Card, CardContent } from '@/components/ui/card.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { cn } from '@/lib/utils.ts';
import { formatCountdown, formatElapsed, formatTime, relativeMinutes } from '@/utils/time.js';

const DELAY_TEXT = {
  traffic: 'heavy traffic',
  loading: 'loading passengers',
  breakdown: 'a mechanical problem',
  inspection: 'a checkpoint inspection',
  weather: 'weather',
  other: 'a delay',
};

/**
 * The arrivals board for one station: every bus heading here, soonest first.
 *
 * The ETA is the largest thing on the screen because it is the only thing most
 * people came for. Everything else — the route, the plate, where it was last
 * confirmed — is supporting evidence for that one number.
 */
export default function StationBoardPage() {
  const { stationId } = useParams();
  const now = useNow(20000);

  const { data, error, loading, lastUpdated } = usePolling(() => fetchStationBoard(stationId), {
    intervalMs: 15000,
    deps: [stationId],
  });

  const arrivals = data?.arrivals ?? [];

  return (
    <>
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        All stops
      </Link>

      <PageHeader
        icon={MapPin}
        title={data?.station?.name ?? 'Loading…'}
        description="Buses currently heading to this stop, soonest first."
        actions={<LiveIndicator lastUpdated={lastUpdated} />}
      />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Could not load this board. {error.message}</AlertDescription>
        </Alert>
      )}

      {loading && !data && (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-[150px] rounded-xl" />
          ))}
        </div>
      )}

      {data && arrivals.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <p className="text-lg font-bold">No buses currently heading here.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Trips appear on this board once they are scheduled or under way.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {arrivals.map((arrival) => (
          <ArrivalRow key={arrival.tripId} arrival={arrival} now={now} />
        ))}
      </div>
    </>
  );
}

function ArrivalRow({ arrival, now }) {
  const minutesAway = relativeMinutes(arrival.eta, now);
  const notDepartedYet = arrival.status === 'scheduled';
  const dimmed = arrival.isStale || notDepartedYet;

  return (
    <Link to={`/trips/${arrival.tripId}`} className="block">
      <Card className="transition-all duration-200 hover:border-primary/40 hover:shadow-md">
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-[19px] font-extrabold tracking-tight">{arrival.route}</div>
              <div className="mt-0.5 text-sm text-muted-foreground">
                {arrival.origin} → {arrival.destination}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StatusBadge
                  status={arrival.status}
                  isStale={arrival.isStale}
                  varianceMinutes={arrival.varianceMinutes}
                />
                {arrival.bus && (
                  <span className="rounded-md border border-border px-2 py-0.5 font-mono text-xs tracking-wide text-muted-foreground">
                    {arrival.bus.plateNumber}
                  </span>
                )}
              </div>

              <div className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                {notDepartedYet ? (
                  <>
                    Departs {formatTime(arrival.scheduledDeparture)} from {arrival.origin}
                  </>
                ) : arrival.lastConfirmedCheckpoint ? (
                  <>
                    Last confirmed at{' '}
                    <span className="font-semibold text-foreground/80">
                      {arrival.lastConfirmedCheckpoint.name}
                    </span>
                    {arrival.minutesSinceLastConfirm !== null && (
                      <> · {formatElapsed(arrival.minutesSinceLastConfirm)} ago</>
                    )}
                    {arrival.stopsAway > 1 && <> · {arrival.stopsAway} stops away</>}
                  </>
                ) : (
                  'Not yet departed'
                )}
              </div>

              {arrival.latestDelay && !arrival.isStale && (
                <div className="mt-2 text-[13px] font-medium text-warning">
                  Conductor reported {DELAY_TEXT[arrival.latestDelay.reason] ?? 'a delay'}
                  {arrival.latestDelay.nearCheckpoint && (
                    <> near {arrival.latestDelay.nearCheckpoint}</>
                  )}
                  , {formatTime(arrival.latestDelay.reportedAt)}
                </div>
              )}
            </div>

            <div className="shrink-0 text-left sm:min-w-[150px] sm:text-right">
              <div
                className={cn(
                  'font-mono tabular text-[44px] font-bold leading-none tracking-tight sm:text-[56px]',
                  dimmed && 'text-muted-foreground'
                )}
              >
                {formatTime(notDepartedYet ? arrival.scheduledEta : arrival.eta)}
              </div>
              <div className="mt-2 text-[13px] font-medium text-muted-foreground">
                {notDepartedYet
                  ? 'scheduled'
                  : arrival.isStale
                    ? 'estimate only'
                    : minutesAway !== null && minutesAway > 1
                      ? formatCountdown(arrival.eta, now)
                      : 'arriving'}
              </div>
            </div>
          </div>

          {arrival.isStale && (
            <div className="mt-4 flex items-start gap-2 border-t border-dashed border-border pt-3 text-[13px] text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                No update in {formatElapsed(arrival.minutesSinceLastConfirm)} — this time may be
                out of date.
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
