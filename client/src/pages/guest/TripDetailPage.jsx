import { Link, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Bus, CircleDot } from 'lucide-react';
import { usePolling, useNow } from '@/hooks/usePolling.js';
import { fetchTrip } from '@/api/publicApi.js';
import { StatusBadge } from '@/components/StatusBadge.jsx';
import { StaleNotice } from '@/components/StaleNotice.jsx';
import { Timeline } from '@/components/Timeline.jsx';
import { PageHeader, LiveIndicator } from '@/components/layout/AppLayout.jsx';
import { sceneFor } from '@/components/BusStatusScene.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { cn } from '@/lib/utils.ts';
import { formatCountdown, formatDay, formatTime, formatVariance } from '@/utils/time.js';

const DELAY_TEXT = {
  traffic: 'heavy traffic',
  loading: 'loading passengers',
  breakdown: 'a mechanical problem',
  inspection: 'a checkpoint inspection',
  weather: 'weather',
  other: 'a delay',
};

/**
 * One trip, end to end. This is where a passenger can check the reasoning
 * behind the number: which checkpoints were actually confirmed, when, and how
 * far off baseline the bus has been running.
 */
export default function TripDetailPage() {
  const { tripId } = useParams();
  const now = useNow(20000);

  const { data, error, loading, lastUpdated } = usePolling(() => fetchTrip(tripId), {
    intervalMs: 15000,
    deps: [tripId],
  });

  const trip = data?.trip;

  const back = (
    <Link
      to="/"
      className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      All stops
    </Link>
  );

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        {back}
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Could not load this trip. {error.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (loading && !trip) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        {back}
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const destination = trip.stops.at(-1);
  const notDepartedYet = !trip.actualDeparture;
  const arrivalTime =
    destination?.actualArrival ?? destination?.projectedArrival ?? destination?.scheduledArrival;

  // A trip page has no stop to be "here" at, so the scene comes from the trip's
  // own state: finished, full, still at its origin, or out on the road.
  const scene = sceneFor({
    hasArrived: trip.status === 'arrived',
    isFull: trip.load === 'full',
    isHereNow: false,
    isDeparture: false,
    notDepartedYet,
  });

  return (
    <div className="mx-auto max-w-3xl">
      {back}

      <PageHeader
        scene={scene}
        icon={Bus}
        title={trip.route.name}
        description={
          <>
            {formatDay(trip.scheduledDeparture)} ·{' '}
            {trip.bus ? `${trip.bus.plateNumber} · ${trip.bus.operatorName}` : 'Bus to be assigned'}
          </>
        }
        actions={<LiveIndicator lastUpdated={lastUpdated} />}
      />

      <div className="space-y-4">
        {trip.isStale && (
          <StaleNotice
            minutesSinceLastConfirm={trip.minutesSinceLastConfirm}
            lastCheckpointName={trip.lastConfirmedCheckpoint?.name}
          />
        )}

        {trip.latestDelay && !trip.isStale && (
          <Alert className="border-warning/50 bg-warning/15">
            <CircleDot className="h-4 w-4 text-warning-strong" />
            <AlertDescription>
              Conductor reported {DELAY_TEXT[trip.latestDelay.reason] ?? 'a delay'}
              {trip.latestDelay.nearCheckpoint && <> near {trip.latestDelay.nearCheckpoint}</>}, at{' '}
              {formatTime(trip.latestDelay.reportedAt)}. The arrival time below still reflects the
              last confirmed checkpoint.
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardContent className="flex flex-col gap-5 p-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 text-sm text-muted-foreground">
                {trip.status === 'arrived' ? 'Arrived at' : 'Arriving at'} {destination?.name}
              </div>
              <StatusBadge
                status={trip.status}
                isStale={trip.isStale}
                varianceMinutes={trip.varianceMinutes}
                conditionsAllowanceMinutes={trip.conditionsAllowanceMinutes}
              />
            </div>
            <div className="sm:text-right">
              <div
                className={cn(
                  'font-mono tabular text-[44px] font-bold leading-none tracking-tight sm:text-[56px]',
                  (trip.isStale || notDepartedYet) && 'text-muted-foreground'
                )}
              >
                {formatTime(arrivalTime)}
              </div>
              {trip.status !== 'arrived' && (
                <div className="mt-2 text-[13px] font-medium text-muted-foreground">
                  {notDepartedYet
                    ? 'scheduled — not departed yet'
                    : formatCountdown(arrivalTime, now)}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid grid-cols-2 gap-5 p-6 sm:grid-cols-4">
            <Fact label="Scheduled departure" mono value={formatTime(trip.scheduledDeparture)} />
            <Fact
              label="Actual departure"
              mono
              value={trip.actualDeparture ? formatTime(trip.actualDeparture) : 'Not yet'}
            />
            <Fact
              label="Running"
              value={formatVariance(trip.varianceMinutes)}
              // Naming the share the road cost is the difference between a
              // passenger blaming the bus and understanding the delay.
              note={
                trip.conditionsAllowanceMinutes > 0 && trip.varianceMinutes > 0
                  ? `${Math.min(trip.conditionsAllowanceMinutes, trip.varianceMinutes)} min of it traffic`
                  : null
              }
            />
            <Fact
              label={trip.status === 'arrived' ? 'Finished at' : 'Last passed'}
              value={trip.lastConfirmedCheckpoint?.name ?? 'Not departed'}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Checkpoints</CardTitle>
            <span className="font-mono text-xs text-muted-foreground">
              {trip.stops.length} points
            </span>
          </CardHeader>
          <CardContent>
            <Timeline
            stops={trip.stops}
            isArrived={trip.status === 'arrived'}
            position={trip.position}
          />
          </CardContent>
        </Card>

        <p className="pb-4 text-center text-[13px] text-muted-foreground">
          Times are estimates based on confirmed checkpoints and this route's usual segment
          times. Shown in Manila time.
        </p>
      </div>
    </div>
  );
}

function Fact({ label, value, mono, note }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className={cn('font-semibold', mono && 'font-mono tabular')}>{value}</div>
      {note ? <div className="mt-0.5 text-xs text-muted-foreground">{note}</div> : null}
    </div>
  );
}
