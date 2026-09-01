import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  MapPin,
  TrafficCone,
} from 'lucide-react';
import { usePolling, useNow } from '@/hooks/usePolling.js';
import { fetchStationBoard } from '@/api/publicApi.js';
import { StatusBadge } from '@/components/StatusBadge.jsx';
import { JourneyStrip } from '@/components/JourneyStrip.jsx';
import { PageHeader, LiveIndicator } from '@/components/layout/AppLayout.jsx';
import { Card, CardContent } from '@/components/ui/card.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { Button } from '@/components/ui/button.tsx';
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
 * Two things a passenger has to be able to do at a glance — read the arrival
 * time, and identify which physical bus that is when it pulls up. So the ETA is
 * the biggest thing on the row and the plate number is the second biggest, not
 * a footnote.
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
        description="Buses heading to this stop, soonest first. Times update each time a conductor confirms the bus has passed a checkpoint."
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
            <Skeleton key={i} className="h-[190px] rounded-xl" />
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
  const [open, setOpen] = useState(false);
  const minutesAway = relativeMinutes(arrival.eta, now);
  const notDepartedYet = arrival.status === 'scheduled';
  const dimmed = arrival.isStale || notDepartedYet;

  return (
    <Card
      className={cn('overflow-hidden', arrival.isHereNow && 'border-success/60 bg-success/[0.04]')}
    >
      <CardContent className="p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            {/* The plate is how you pick this bus out of five at a curb, so it
                is set as an identifier, not as metadata. */}
            {arrival.bus && (
              <div className="mb-2 inline-flex items-center gap-2 rounded-lg border-2 border-foreground/15 bg-muted/60 px-3 py-1.5">
                <span className="font-mono text-[19px] font-bold tracking-[0.08em]">
                  {arrival.bus.plateNumber}
                </span>
              </div>
            )}

            <div className="text-[17px] font-extrabold tracking-tight">{arrival.route}</div>
            <div className="mt-0.5 text-sm text-muted-foreground">
              {arrival.bus?.operatorName}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusBadge
                status={arrival.status}
                isStale={arrival.isStale}
                varianceMinutes={arrival.varianceMinutes}
              />
            </div>

            {/* Plain answers to "where is it" and "does it go where I want". */}
            <div className="mt-3 space-y-1 text-[13px] leading-relaxed">
              {/*
                * Three genuinely different situations, and a passenger acts
                * differently on each. Standing at a stop means the doors may
                * still be open; on the road means settle in.
                */}
              <div className="text-muted-foreground">
                {notDepartedYet ? (
                  <>
                    Still at <span className="font-semibold text-foreground">{arrival.origin}</span>{' '}
                    · leaves {formatTime(arrival.scheduledDeparture)}
                  </>
                ) : arrival.position === 'at_stop' && arrival.lastConfirmedCheckpoint ? (
                  <span className="font-semibold text-success">
                    At {arrival.lastConfirmedCheckpoint.name} now — boarding
                  </span>
                ) : arrival.lastConfirmedCheckpoint && arrival.nextCheckpoint ? (
                  <>
                    On the road between{' '}
                    <span className="font-semibold text-foreground">
                      {arrival.lastConfirmedCheckpoint.name}
                    </span>{' '}
                    and{' '}
                    <span className="font-semibold text-foreground">
                      {arrival.nextCheckpoint.name}
                    </span>
                    {arrival.stopsAway > 0 && (
                      <>
                        {' '}
                        · {arrival.stopsAway} stop{arrival.stopsAway === 1 ? '' : 's'} away
                      </>
                    )}
                  </>
                ) : arrival.lastConfirmedCheckpoint ? (
                  <>
                    Past{' '}
                    <span className="font-semibold text-foreground">
                      {arrival.lastConfirmedCheckpoint.name}
                    </span>
                  </>
                ) : (
                  'Not yet departed'
                )}
              </div>

              {arrival.lastConfirmedAt && !notDepartedYet && (
                <div className="text-muted-foreground">
                  {arrival.position === 'at_stop' ? (
                    <>
                      Pulled in at {formatTime(arrival.lastConfirmedAt)}
                      {arrival.minutesSinceLastConfirm !== null && (
                        <> · {formatElapsed(arrival.minutesSinceLastConfirm)} ago</>
                      )}
                    </>
                  ) : (
                    arrival.positionInferred ? (
                      <>
                        Reached {arrival.lastConfirmedCheckpoint?.name} at{' '}
                        {formatTime(arrival.lastConfirmedAt)} — assumed to have left, though the
                        conductor has not confirmed it
                      </>
                    ) : (
                      <>
                        Left {arrival.lastConfirmedCheckpoint?.name} at{' '}
                        {formatTime(arrival.leftLastCheckpointAt ?? arrival.lastConfirmedAt)}
                        {arrival.minutesSinceLastConfirm !== null && (
                          <> · {formatElapsed(arrival.minutesSinceLastConfirm)} ago</>
                        )}
                      </>
                    )
                  )}
                </div>
              )}

              {arrival.continuesTo?.length > 0 && (
                <div className="text-muted-foreground">
                  After this stop, continues to{' '}
                  <span className="font-semibold text-foreground">
                    {arrival.continuesTo.join(' → ')}
                  </span>
                </div>
              )}
            </div>

            {arrival.traffic && (
              <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-warning/50 bg-warning/15 px-3 py-2.5 text-[13px] text-foreground">
                <TrafficCone className="mt-0.5 h-4 w-4 shrink-0 text-warning-strong" />
                <span>
                  <strong className="font-bold">
                    Traffic {arrival.traffic.adjustmentMinutes > 0 ? '+' : ''}
                    {arrival.traffic.adjustmentMinutes} min
                  </strong>{' '}
                  on {arrival.traffic.segment}, already included in the time shown.
                </span>
              </div>
            )}

            {arrival.latestDelay && !arrival.isStale && (
              <div className="mt-2 text-[13px] font-medium text-warning-strong">
                Conductor reported {DELAY_TEXT[arrival.latestDelay.reason] ?? 'a delay'}
                {arrival.latestDelay.nearCheckpoint && (
                  <> near {arrival.latestDelay.nearCheckpoint}</>
                )}
                , {formatTime(arrival.latestDelay.reportedAt)}
              </div>
            )}
          </div>

          <div className="shrink-0 text-left sm:min-w-[160px] sm:text-right">
            <div
              className={cn(
                'mb-1 text-[11px] font-bold uppercase tracking-[0.12em]',
                arrival.isHereNow ? 'text-success' : 'text-muted-foreground'
              )}
            >
              {arrival.isHereNow
                ? 'At this stop now'
                : notDepartedYet
                  ? 'Scheduled arrival'
                  : 'Expected arrival'}
            </div>
            <div
              className={cn(
                'font-mono tabular text-[44px] font-bold leading-none tracking-tight sm:text-[56px]',
                arrival.isHereNow && 'text-success',
                dimmed && !arrival.isHereNow && 'text-muted-foreground'
              )}
            >
              {formatTime(notDepartedYet ? arrival.scheduledEta : arrival.eta)}
            </div>
            <div
              className={cn(
                'mt-2 text-[13px] font-medium',
                arrival.isHereNow ? 'font-bold text-success' : 'text-muted-foreground'
              )}
            >
              {arrival.isHereNow
                ? 'boarding — pulled in at this time'
                : notDepartedYet
                  ? 'if it leaves on time'
                  : arrival.isStale
                    ? 'rough estimate'
                    : minutesAway !== null && minutesAway > 1
                      ? formatCountdown(arrival.eta, now)
                      : 'arriving now'}
            </div>
          </div>
        </div>

        {arrival.isStale && (
          <div className="mt-4 flex items-start gap-2 border-t border-dashed border-border pt-3 text-[13px] text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              No update in {formatElapsed(arrival.minutesSinceLastConfirm)} — this time may be out
              of date.
            </span>
          </div>
        )}

        <div className="mt-4 border-t border-border pt-3">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-8 text-muted-foreground"
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronDown
              className={cn('mr-1.5 h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
            />
            {open ? 'Hide full route' : 'See the full route'}
          </Button>

          {open && (
            <div className="mt-3 space-y-3">
              <JourneyStrip journey={arrival.journey} />
              <Link
                to={`/trips/${arrival.tripId}`}
                className="inline-block text-[13px] font-semibold text-primary underline-offset-4 hover:underline"
              >
                Full trip details →
              </Link>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
