import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CloudOff,
  Flag,
  MapPin,
  RefreshCw,
  UploadCloud,
} from 'lucide-react';
import { usePolling } from '@/hooks/usePolling.js';
import { useOfflineQueue } from '@/hooks/useOfflineQueue.js';
import { fetchMyTrip } from '@/api/conductorApi.js';
import { StatusBadge } from '@/components/StatusBadge.jsx';
import { Timeline } from '@/components/Timeline.jsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { cn } from '@/lib/utils.ts';
import { formatTime, formatVariance } from '@/utils/time.js';

const DELAY_REASONS = [
  { value: 'traffic', label: 'Traffic' },
  { value: 'loading', label: 'Loading' },
  { value: 'breakdown', label: 'Breakdown' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'weather', label: 'Weather' },
  { value: 'other', label: 'Other' },
];

/**
 * The conductor's screen. Four things it must do well: be readable in daylight,
 * take a tap without hesitation, say clearly that the tap was recorded, and be
 * honest when that tap is still sitting in a queue waiting for signal.
 *
 * There is no map and no location permission. The conductor tells the system
 * where the bus is; the system never tries to work it out.
 */
export default function ConductorTripPage() {
  const { tripId } = useParams();
  const [confirmation, setConfirmation] = useState(null);
  const [showAllStops, setShowAllStops] = useState(false);
  const [showDelay, setShowDelay] = useState(false);

  const { data, error, loading, setData } = usePolling(() => fetchMyTrip(tripId), {
    intervalMs: 30000,
    deps: [tripId],
  });

  const onSynced = useCallback((trip) => setData({ trip }), [setData]);
  const { enqueue, pendingCount, isOnline, isSyncing, flush } = useOfflineQueue(tripId, {
    onSynced,
  });

  // The confirmation is a receipt, not an alert — it fades on its own.
  useEffect(() => {
    if (!confirmation) return undefined;
    const id = setTimeout(() => setConfirmation(null), 6000);
    return () => clearTimeout(id);
  }, [confirmation]);

  const trip = data?.trip;

  const { nextStop, remainingStops, destination } = useMemo(() => {
    const stops = trip?.stops ?? [];
    const firstPending = stops.findIndex((s) => s.progress === 'pending');
    return {
      nextStop: firstPending === -1 ? null : stops[firstPending],
      remainingStops: firstPending === -1 ? [] : stops.slice(firstPending),
      destination: stops.at(-1) ?? null,
    };
  }, [trip]);

  const back = (
    <Link
      to="/conductor"
      className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Your trips
    </Link>
  );

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        {back}
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (loading && !trip) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {back}
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  const tap = (entry, message) => {
    enqueue(entry);
    setConfirmation({ message, at: new Date() });
    setShowAllStops(false);
    setShowDelay(false);
  };

  const notDeparted = !trip.actualDeparture;
  const finished = trip.status === 'arrived' || trip.status === 'cancelled';

  return (
    <div className="mx-auto max-w-2xl">
      {back}

      <div className="mb-6">
        <h1 className="text-3xl font-black tracking-tight">{trip.route.name}</h1>
        <p className="mt-1 text-[15px] font-medium text-muted-foreground">
          {trip.bus?.plateNumber} · departs {formatTime(trip.scheduledDeparture)}
        </p>
      </div>

      <QueueBanner
        pendingCount={pendingCount}
        isOnline={isOnline}
        isSyncing={isSyncing}
        onRetry={flush}
      />

      <AnimatePresence>
        {confirmation && (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            transition={{ duration: 0.2 }}
            className="mb-4 overflow-hidden"
          >
            <div className="flex items-center gap-3 rounded-xl border border-success/40 bg-success/10 p-4">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-success text-success-foreground">
                <Check className="h-4 w-4" strokeWidth={3} />
              </span>
              <div>
                <div className="font-bold">{confirmation.message}</div>
                <div className="text-[13px] text-muted-foreground">
                  Recorded at {formatTime(confirmation.at)}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Card className="mb-4">
        <CardContent className="flex items-start justify-between gap-4 p-5">
          <div>
            <StatusBadge
              status={trip.status}
              isStale={trip.isStale}
              varianceMinutes={trip.varianceMinutes}
            />
            <div className="mt-3 text-xl font-extrabold tracking-tight">
              {formatVariance(trip.varianceMinutes)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              Last confirmed
            </div>
            <div className="mt-1 font-semibold">{trip.lastConfirmedCheckpoint?.name ?? '—'}</div>
            {trip.lastConfirmedAt && (
              <div className="font-mono tabular text-[13px] text-muted-foreground">
                {formatTime(trip.lastConfirmedAt)}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {!finished && (
        <div className="mb-6 space-y-3">
          {notDeparted ? (
            <TapButton
              primary
              icon={Flag}
              label="Depart now"
              sub="Starts the clock for this trip"
              onClick={() => tap({ type: 'departed' }, 'Departure recorded')}
            />
          ) : (
            <>
              {nextStop && nextStop.checkpointId !== destination?.checkpointId && (
                <TapButton
                  primary
                  icon={MapPin}
                  label={`Passed ${nextStop.name}`}
                  sub="Next checkpoint on this route"
                  onClick={() =>
                    tap(
                      { type: 'passed_checkpoint', checkpoint: nextStop.checkpointId },
                      `Passed ${nextStop.name}`
                    )
                  }
                />
              )}

              <TapButton
                icon={Flag}
                label={`Arrived at ${destination?.name}`}
                sub="Ends the trip"
                onClick={() => tap({ type: 'arrived' }, `Arrival at ${destination?.name} recorded`)}
              />

              {remainingStops.length > 1 && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setShowAllStops((v) => !v)}
                >
                  {showAllStops ? 'Hide other checkpoints' : 'Passed a different checkpoint'}
                </Button>
              )}

              {showAllStops && (
                <ChipRow>
                  {remainingStops
                    .filter((s) => s.checkpointId !== destination?.checkpointId)
                    .map((stop) => (
                      <Chip
                        key={stop.checkpointId}
                        onClick={() =>
                          tap(
                            { type: 'passed_checkpoint', checkpoint: stop.checkpointId },
                            `Passed ${stop.name}`
                          )
                        }
                      >
                        {stop.name}
                      </Chip>
                    ))}
                </ChipRow>
              )}
            </>
          )}

          {!notDeparted && (
            <>
              <Button variant="outline" className="w-full" onClick={() => setShowDelay((v) => !v)}>
                {showDelay ? 'Cancel' : 'Report a delay'}
              </Button>

              {showDelay && (
                <ChipRow>
                  {DELAY_REASONS.map((reason) => (
                    <Chip
                      key={reason.value}
                      onClick={() =>
                        tap(
                          { type: 'delayed', delayReason: reason.value },
                          `Delay reported: ${reason.label.toLowerCase()}`
                        )
                      }
                    >
                      {reason.label}
                    </Chip>
                  ))}
                </ChipRow>
              )}
            </>
          )}
        </div>
      )}

      {finished && (
        <Alert className="mb-4">
          <Check className="h-4 w-4" />
          <AlertDescription>
            This trip is {trip.status}. No further updates are needed.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Route</CardTitle>
        </CardHeader>
        <CardContent>
          <Timeline stops={trip.stops} lastConfirmedName={trip.lastConfirmedCheckpoint?.name} />
        </CardContent>
      </Card>
    </div>
  );
}

/** Big enough to hit one-handed, standing, on a moving bus. */
function TapButton({ icon: Icon, label, sub, onClick, primary }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-4 rounded-xl border p-5 text-left transition-all duration-150 active:scale-[0.985]',
        primary
          ? 'border-primary bg-primary text-primary-foreground shadow-sm hover:shadow-md'
          : 'border-border bg-card hover:border-foreground/20 hover:bg-muted'
      )}
    >
      <span
        className={cn(
          'grid h-11 w-11 shrink-0 place-items-center rounded-xl',
          primary ? 'bg-primary-foreground/15' : 'bg-muted'
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-[18px] font-bold leading-tight">{label}</span>
        <span className={cn('block text-[13px]', primary ? 'opacity-80' : 'text-muted-foreground')}>
          {sub}
        </span>
      </span>
    </button>
  );
}

const ChipRow = ({ children }) => <div className="flex flex-wrap gap-2 py-1">{children}</div>;

const Chip = ({ children, onClick }) => (
  <button
    onClick={onClick}
    className="h-12 rounded-full border border-border bg-card px-5 text-[15px] font-semibold transition-colors hover:border-foreground/20 hover:bg-muted active:scale-[0.97]"
  >
    {children}
  </button>
);

/**
 * The offline state, stated plainly.
 *
 * A queued tap is not an error and must not look like one — it is the system
 * working as designed on a route with no signal. What the conductor needs to
 * know is simply that nothing was lost.
 */
function QueueBanner({ pendingCount, isOnline, isSyncing, onRetry }) {
  if (!pendingCount && isOnline) return null;

  if (!pendingCount && !isOnline) {
    return (
      <Alert className="mb-4 bg-muted/50">
        <CloudOff className="h-4 w-4" />
        <AlertDescription>No connection. Your taps will still be recorded.</AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert className="mb-4 border-primary/30 bg-primary/5">
      <UploadCloud className="h-4 w-4 text-primary" />
      <AlertDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>
          <strong className="font-bold text-foreground">
            {pendingCount} update{pendingCount === 1 ? '' : 's'} waiting to send.
          </strong>{' '}
          {isSyncing
            ? 'Sending now…'
            : isOnline
              ? 'Will send automatically.'
              : 'They will send as soon as there is signal.'}
        </span>
        {isOnline && !isSyncing && (
          <Button variant="ghost" size="sm" onClick={onRetry} className="h-7">
            <RefreshCw className="mr-1.5 h-3 w-3" />
            Try now
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
