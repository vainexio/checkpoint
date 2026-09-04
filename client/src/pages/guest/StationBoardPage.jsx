import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { SegmentedTabs } from '@/components/SegmentedTabs.jsx';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Ban,
  ChevronDown,
  Footprints,
  MapPin,
  MonitorPlay,
  TrafficCone,
} from 'lucide-react';
import { usePolling, useNow } from '@/hooks/usePolling.js';
import { fetchStationBoard } from '@/api/publicApi.js';
import { Badge } from '@/components/ui/badge.tsx';
import { StatusBadge } from '@/components/StatusBadge.jsx';
import { SeatBadge } from '@/components/SeatPicker.jsx';
import { JourneyStrip } from '@/components/JourneyStrip.jsx';
import { ArrivalCountdown } from '@/components/ArrivalCountdown.jsx';
import { BusStatusScene, sceneFor } from '@/components/BusStatusScene.jsx';
import { PageHeader, LiveIndicator } from '@/components/layout/AppLayout.jsx';
import { Card, CardContent } from '@/components/ui/card.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { Button } from '@/components/ui/button.tsx';
import { cn } from '@/lib/utils.ts';
import { directionsUrl } from '@/utils/directions.js';
import { formatElapsed, formatTime } from '@/utils/time.js';

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
  const [filter, setFilter] = useState('all');

  // A bus you can walk up to: standing here, or starting its run from here.
  // "Leaving" described what the bus was about to do; this describes where it
  // is, which is what someone reading the board is trying to find out.
  const isHere = (a) => a.isHereNow || a.boardKind === 'departure';
  const counts = {
    here: arrivals.filter(isHere).length,
    arriving: arrivals.filter((a) => !isHere(a)).length,
  };
  const shown = arrivals.filter((a) =>
    filter === 'all' ? true : filter === 'here' ? isHere(a) : !isHere(a)
  );

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
        bare
        icon={MapPin}
        title={data?.station?.name ?? 'Loading…'}
        description="Buses heading to this stop, soonest first. Times update each time a conductor confirms the bus has passed a checkpoint."
        actions={
          /* A column of three stacked rows is a lot of header on a phone; in a
             row they fit on one line and the buses start higher. */
          <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
            <LiveIndicator lastUpdated={lastUpdated} />
            <a
              href={`/display/${stationId}`}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-[13px] font-semibold text-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              <MonitorPlay className="h-3.5 w-3.5" />
              Terminal display
            </a>
            {data?.station?.location && (
              <a
                href={directionsUrl(data.station.location)}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-[13px] font-semibold text-foreground transition-colors hover:border-primary/50 hover:text-primary"
              >
                <Footprints className="h-3.5 w-3.5" />
                {/* Two buttons only fit side by side on a phone if the second
                    one gives up the words it does not need. */}
                Directions<span className="hidden sm:inline">&nbsp;to this stop</span>
              </a>
            )}
          </div>
        }
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

      {arrivals.length > 0 && (
        <div className="relative z-10 mb-3 flex justify-center">
          <SegmentedTabs
            options={[
              { value: 'all', label: 'All', count: arrivals.length },
              { value: 'here', label: 'At this station', count: counts.here },
              { value: 'arriving', label: 'Arriving', count: counts.arriving },
            ]}
            value={filter}
            onChange={setFilter}
          />
        </div>
      )}

      {/*
        * Rows ease in one after another when the board first draws, and move to
        * their new places rather than jumping when the filter changes. The
        * layout animation is what makes a filter feel like the same list being
        * sorted instead of a different page arriving.
        */}
      <div className="relative z-10 space-y-3">
        <AnimatePresence initial={false} mode="popLayout">
          {shown.map((arrival, i) => (
            <motion.div
              key={arrival.tripId}
              layout
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.16 } }}
              transition={{
                duration: 0.34,
                delay: Math.min(i * 0.04, 0.28),
                ease: [0.22, 1, 0.36, 1],
                layout: { type: 'spring', stiffness: 380, damping: 34 },
              }}
            >
              <ArrivalRow arrival={arrival} now={now} stationName={data?.station?.name} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
  );
}

function ArrivalRow({ arrival, now, stationName }) {
  const [open, setOpen] = useState(false);
  const notDepartedYet = arrival.status === 'scheduled';
  const isDeparture = arrival.boardKind === 'departure';
  const hasArrived = arrival.boardKind === 'arrived';
  const isFull = arrival.load === 'full';
  // Live congestion on the leg it is on now, from the road ahead rather than
  // the whole trip's history.
  //
  // Suppressed once a trip goes stale: "the leg ahead" is measured from the
  // last confirmed checkpoint, and when that was hours ago the bus may be
  // nowhere near it. Drawing it crawling through a jam would be claiming to
  // know exactly what the stale flag exists to admit we do not.
  const trafficMinutes = arrival.isStale ? 0 : (arrival.traffic?.adjustmentMinutes ?? 0);
  const scene = sceneFor({
    hasArrived,
    isFull,
    isHereNow: arrival.isHereNow,
    isDeparture,
    notDepartedYet,
    isLate: arrival.status === 'delayed',
    // Live congestion on the leg it is on *now*, not the total it has driven
    // through. `conditionsAllowanceMinutes` accumulates over the whole trip,
    // so a bus that met traffic an hour ago and is cruising since would have
    // drawn a permanent crawl. The server already reads the road immediately
    // ahead and drops anything under three minutes as noise.
    inTraffic: trafficMinutes > 0,
  });

  return (
    <Card
      className={cn(
        'card-lift overflow-hidden',
        arrival.isHereNow && 'border-success/60 tint-success',
        isDeparture && 'border-primary/50 tint-primary',
        hasArrived && 'opacity-70',
        // The whole value of a "full" report is telling someone not to wait, so
        // the row has to stop looking like something to wait for.
        isFull && 'border-destructive/40 tint-destructive'
      )}
    >
      {/* What the bus is doing, drawn, before any of it is read. */}
      <BusStatusScene
        scene={scene}
        atLabel={arrival.origin}
        hereLabel={stationName}
      />

      {isFull && (
        <div className="flex items-center gap-2 bg-destructive/10 px-5 py-2 text-[13px] font-bold text-destructive">
          <Ban className="h-3.5 w-3.5 shrink-0" />
          Not picking up passengers — don't wait for this one
        </div>
      )}
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            {/* The plate is how you pick this bus out of five at a curb, so it
                is set as an identifier, not as metadata. */}
            {arrival.bus && (
              <div className="mb-1.5 inline-flex items-center gap-2 rounded-lg border-2 border-foreground/15 bg-muted/60 px-2.5 py-1">
                <span className="font-mono text-[17px] font-bold tracking-[0.08em]">
                  {arrival.bus.plateNumber}
                </span>
              </div>
            )}

            <div className="text-[17px] font-extrabold tracking-tight">{arrival.route}</div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge
                status={arrival.status}
                isStale={arrival.isStale}
                varianceMinutes={arrival.varianceMinutes}
                conditionsAllowanceMinutes={arrival.conditionsAllowanceMinutes}
              />
              <SeatBadge load={arrival.load} showSource={false} />
              {trafficMinutes > 0 && (
                <Badge variant="warning">Traffic ahead · +{trafficMinutes} min</Badge>
              )}
            </div>

            {/*
              * Collapsed, this row answers two questions and no others: when
              * can I get on, and can I get on at all. Where the bus is, when it
              * last reported, and which stops it has behind it are all true and
              * all beside the point while someone is deciding whether to keep
              * waiting — they live under Details, where the same facts were
              * being repeated a third time anyway.
              *
              * The exception is a bus that is here, or leaving from here. That
              * changes what the passenger should do in the next few seconds, so
              * it stays on the face of the card.
              */}
            {(arrival.isHereNow || isDeparture || hasArrived || notDepartedYet) && (
              <div className="mt-2 text-[13px] leading-relaxed">
                {hasArrived ? (
                  <span className="text-muted-foreground">
                    Completed · arrived from{' '}
                    <span className="font-semibold text-foreground">{arrival.origin}</span>
                  </span>
                ) : isDeparture ? (
                  <span className="font-semibold text-primary">
                    Waiting here · departs for {arrival.destination}
                  </span>
                ) : arrival.isHereNow ? (
                  <span className="font-semibold text-success">
                    At this stop now — boarding
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Still at <span className="font-semibold text-foreground">{arrival.origin}</span>
                  </span>
                )}
              </div>
            )}
          </div>

          <ArrivalCountdown
            className="shrink-0 sm:min-w-[150px]"
            time={arrival.boardTime}
            now={now}
            kind={arrival.boardKind}
            isHereNow={arrival.isHereNow}
            isStale={arrival.isStale}
          />
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

        <div className="mt-3 border-t border-border pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-8 text-muted-foreground"
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronDown
              className={cn('mr-1.5 h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
            />
            {open ? 'Less' : 'Details & full route'}
          </Button>

          {open && (
            <div className="mt-3 space-y-3 text-[13px] leading-relaxed">
              {/*
                * One line, and it deliberately names no stop.
                *
                * The strip below already draws every stop, its time, which one
                * the bus has left and which one you are standing at — so
                * repeating that in prose was how the same terminal ended up
                * printed four times on one card. What the drawing cannot show
                * is who runs the bus and how long ago anyone last heard from
                * it, so that is all this says.
                */}
              <div className="text-muted-foreground">
                {arrival.bus?.operatorName}
                {arrival.minutesSinceLastConfirm !== null && !notDepartedYet && (
                  <> · last confirmed {formatElapsed(arrival.minutesSinceLastConfirm)} ago</>
                )}
                {arrival.stopsAway > 0 && (
                  <>
                    {' '}
                    · {arrival.stopsAway} stop{arrival.stopsAway === 1 ? '' : 's'} from here
                  </>
                )}
              </div>

              {arrival.continuesTo?.length > 0 && (
                <div className="text-muted-foreground">
                  After this stop, continues to{' '}
                  <span className="font-semibold text-foreground">
                    {arrival.continuesTo.join(' → ')}
                  </span>
                </div>
              )}

              {arrival.traffic && (
                <div className="flex items-start gap-2.5 rounded-lg border border-warning/50 bg-warning/15 px-3 py-2 text-foreground">
                  <TrafficCone className="mt-0.5 h-4 w-4 shrink-0 text-warning-strong" />
                  <span>
                    <strong className="font-bold">
                      Traffic {arrival.traffic.adjustmentMinutes > 0 ? '+' : ''}
                      {arrival.traffic.adjustmentMinutes} min
                    </strong>{' '}
                    {/* The segment is the leg the bus is on, which the strip
                        below already shows. Naming both its stops here made
                        this the fourth mention of the same terminal. */}
                    on the leg it is driving now, already included in the time shown.
                  </span>
                </div>
              )}

              {arrival.latestDelay && !arrival.isStale && (
                <div className="font-medium text-warning-strong">
                  Conductor reported {DELAY_TEXT[arrival.latestDelay.reason] ?? 'a delay'}
                  {arrival.latestDelay.nearCheckpoint && (
                    <> near {arrival.latestDelay.nearCheckpoint}</>
                  )}
                  , {formatTime(arrival.latestDelay.reportedAt)}
                </div>
              )}

              <JourneyStrip journey={arrival.journey} />
              <Link
                to={`/trips/${arrival.tripId}`}
                className="inline-block font-semibold text-primary underline-offset-4 hover:underline"
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
