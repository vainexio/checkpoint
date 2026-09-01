import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  CloudOff,
  Flag,
  LogOut,
  MapPin,
  RefreshCw,
  RotateCcw,
  TriangleAlert,
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
 * The conductor's screen, built around one question: what do I press right now?
 *
 * At any moment exactly one action is the expected one, so exactly one button
 * looks like the answer. Everything else is deliberately quieter, and the two
 * that are hard to take back — ending the trip, or logging a checkpoint out of
 * order — are behind an extra tap that names the consequence.
 *
 * Every tap can also be undone for a few minutes, because a wrong button on a
 * moving bus is a matter of when, not if. Undo is safe here because trip state
 * is a replay of the logs: removing one and recomputing cannot leave the trip
 * half-corrected.
 *
 * There is no map and no location permission. The conductor tells the system
 * where the bus is; the system never tries to work it out.
 */
export default function ConductorTripPage() {
  const { tripId } = useParams();
  const [receipt, setReceipt] = useState(null);
  const [panel, setPanel] = useState(null); // 'other' | 'delay' | 'arrive' | null
  const [undoError, setUndoError] = useState(null);

  const { data, error, loading, setData } = usePolling(() => fetchMyTrip(tripId), {
    intervalMs: 30000,
    deps: [tripId],
  });

  const onSynced = useCallback((trip) => setData({ trip }), [setData]);
  const { enqueue, undo, pendingCount, isOnline, isSyncing, flush } = useOfflineQueue(tripId, {
    onSynced,
  });

  // The receipt is a confirmation, not an alert. It carries the undo, so it
  // stays long enough to actually notice a mistake.
  useEffect(() => {
    if (!receipt) return undefined;
    const id = setTimeout(() => setReceipt(null), 20000);
    return () => clearTimeout(id);
  }, [receipt]);

  const trip = data?.trip;

  const { nextStop, laterStops, destination, atFinalLeg, standingAt } = useMemo(() => {
    const stops = trip?.stops ?? [];
    const firstPending = stops.findIndex((s) => s.progress === 'pending');
    const dest = stops.at(-1) ?? null;
    const next = firstPending === -1 ? null : stops[firstPending];
    const lastPassed = stops.reduce((acc, s, i) => (s.progress === 'passed' ? i : acc), -1);
    return {
      // The stop the bus is standing at, if the conductor has confirmed
      // reaching it but not yet leaving.
      standingAt: trip?.position === 'at_stop' && lastPassed >= 0 ? stops[lastPassed] : null,
      nextStop: next,
      // Everything ahead except the next one and the destination — the "I missed
      // one" case, which should never be as easy to hit as the normal case.
      laterStops:
        firstPending === -1
          ? []
          : stops.slice(firstPending + 1).filter((s) => s.checkpointId !== dest?.checkpointId),
      destination: dest,
      atFinalLeg: !!next && !!dest && next.checkpointId === dest.checkpointId,
    };
  }, [trip]);

  const back = (
    <Link
      to="/conductor"
      className="mb-6 inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
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
    const log = enqueue(entry);
    setReceipt({ message, at: new Date(), clientLogId: log.clientLogId });
    setPanel(null);
    setUndoError(null);
  };

  const undoLast = async () => {
    if (!receipt) return;
    try {
      await undo(receipt.clientLogId);
      setReceipt(null);
      setUndoError(null);
    } catch (err) {
      setUndoError(err.message);
    }
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
        {receipt && (
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
              <div className="min-w-0 flex-1">
                <div className="font-bold">{receipt.message}</div>
                <div className="text-[13px] text-muted-foreground">
                  Recorded at {formatTime(receipt.at)}
                </div>
                {undoError && (
                  <div className="mt-1 text-[13px] font-medium text-destructive">{undoError}</div>
                )}
              </div>
              {/* Wrong button on a moving bus is a matter of when, not if. */}
              <Button variant="outline" size="sm" className="shrink-0" onClick={undoLast}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Undo
              </Button>
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
              Last passed
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
        <div className="mb-6">
          {/* ------------------------------------------------ the one action */}
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            {notDeparted
              ? 'When you leave the terminal'
              : standingAt
                ? 'You are at a stop — tap when you pull out'
                : 'Tap when you reach this point'}
          </p>

          {notDeparted ? (
            <TapButton
              primary
              icon={Flag}
              label="We have departed"
              sub={`Leaving ${trip.stops[0]?.name}. Starts the clock for this trip.`}
              onClick={() => tap({ type: 'departed' }, 'Departure recorded')}
            />
          ) : standingAt ? (
            /*
              * A stop is two events, not one. Until the conductor reports
              * pulling out, the board tells waiting passengers the bus is
              * still here with its doors open — which is the difference
              * between them running for it and giving up on it.
              */
            <TapButton
              primary
              icon={LogOut}
              label={`Leaving ${standingAt.name}`}
              sub="Tells passengers here that the bus has gone"
              onClick={() =>
                tap(
                  { type: 'left_checkpoint', checkpoint: standingAt.checkpointId },
                  `Departure from ${standingAt.name} recorded`
                )
              }
            />
          ) : atFinalLeg ? (
            // The only remaining point *is* the destination, so arriving is now
            // the expected action rather than the dangerous one.
            <ArriveButton
              destination={destination}
              open={panel === 'arrive'}
              onOpen={() => setPanel(panel === 'arrive' ? null : 'arrive')}
              onConfirm={() => tap({ type: 'arrived' }, `Arrival at ${destination?.name} recorded`)}
              expected
            />
          ) : (
            <TapButton
              primary
              icon={MapPin}
              label={
                nextStop?.type === 'landmark'
                  ? `Passed ${nextStop.name}`
                  : `Arrived at ${nextStop?.name}`
              }
              sub={
                nextStop?.type === 'landmark'
                  ? 'Timing point — no boarding here'
                  : 'Shows this bus as boarding at this stop'
              }
              onClick={() =>
                tap(
                  { type: 'passed_checkpoint', checkpoint: nextStop.checkpointId },
                  nextStop?.type === 'landmark'
                    ? `Passed ${nextStop.name}`
                    : `Arrival at ${nextStop.name} recorded`
                )
              }
            />
          )}

          {/* --------------------------------------------- everything else */}
          {!notDeparted && (
            <div className="mt-5 space-y-2 border-t border-border pt-4">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Something else
              </p>

              <SecondaryButton onClick={() => setPanel(panel === 'delay' ? null : 'delay')}>
                Report a delay
              </SecondaryButton>
              {panel === 'delay' && (
                <>
                  <p className="px-1 pt-1 text-[13px] text-muted-foreground">
                    This adds a note for passengers. It does not change your arrival time.
                  </p>
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
                </>
              )}

              {laterStops.length > 0 && (
                <>
                  <SecondaryButton onClick={() => setPanel(panel === 'other' ? null : 'other')}>
                    I passed a later point without tapping
                  </SecondaryButton>
                  {panel === 'other' && (
                    <>
                      <p className="px-1 pt-1 text-[13px] text-muted-foreground">
                        Only use this if you have already gone past {nextStop?.name}. Anything
                        skipped is marked unconfirmed.
                      </p>
                      <ChipRow>
                        {laterStops.map((stop) => (
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
                    </>
                  )}
                </>
              )}

              {/* Ending the trip early is the most destructive thing here, so
                  it is the quietest control and always asks first. */}
              {!atFinalLeg && (
                <ArriveButton
                  destination={destination}
                  open={panel === 'arrive'}
                  onOpen={() => setPanel(panel === 'arrive' ? null : 'arrive')}
                  onConfirm={() =>
                    tap({ type: 'arrived' }, `Arrival at ${destination?.name} recorded`)
                  }
                />
              )}
            </div>
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
          <Timeline
            stops={trip.stops}
            isArrived={trip.status === 'arrived'}
            position={trip.position}
          />
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Ending the trip is irreversible in the conductor's mind even though it is
 * technically undoable, so it always names the consequence and asks again.
 */
function ArriveButton({ destination, open, onOpen, onConfirm, expected = false }) {
  if (expected) {
    return (
      <div className="space-y-2">
        <TapButton
          primary
          icon={Flag}
          label={destination?.name}
          sub="Final stop — this ends the trip"
          onClick={onOpen}
        />
        {open && (
          <ConfirmRow
            question={`End the trip at ${destination?.name}?`}
            confirmLabel="Yes, we have arrived"
            onConfirm={onConfirm}
            onCancel={onOpen}
          />
        )}
      </div>
    );
  }

  return (
    <>
      <SecondaryButton danger onClick={onOpen}>
        End trip early — arrived at {destination?.name}
      </SecondaryButton>
      {open && (
        <ConfirmRow
          question={`End the trip now? You have not confirmed every point yet, and the board will stop showing this bus as running.`}
          confirmLabel="Yes, end the trip"
          onConfirm={onConfirm}
          onCancel={onOpen}
        />
      )}
    </>
  );
}

function ConfirmRow({ question, confirmLabel, onConfirm, onCancel }) {
  return (
    <div className="rounded-xl border border-warning/50 bg-warning/10 p-4">
      <div className="mb-3 flex items-start gap-2">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning-strong" />
        <p className="text-[14px] font-medium">{question}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onConfirm}>{confirmLabel}</Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Big enough to hit one-handed, standing, on a moving bus. */
function TapButton({ icon: Icon, label, sub, onClick, primary }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full cursor-pointer items-center gap-4 rounded-xl border p-5 text-left',
        'transition-all duration-150 active:scale-[0.985]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        primary
          ? 'border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow-md'
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
        <span className="block text-[19px] font-bold leading-tight">{label}</span>
        <span className={cn('block text-[13px]', primary ? 'opacity-85' : 'text-muted-foreground')}>
          {sub}
        </span>
      </span>
    </button>
  );
}

function SecondaryButton({ children, onClick, danger = false }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-border',
        'bg-card px-4 py-3 text-left text-[15px] font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        danger
          ? 'text-destructive hover:border-destructive/40 hover:bg-destructive/5'
          : 'hover:border-foreground/20 hover:bg-muted'
      )}
    >
      {children}
      <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
    </button>
  );
}

const ChipRow = ({ children }) => <div className="flex flex-wrap gap-2 py-1">{children}</div>;

const Chip = ({ children, onClick }) => (
  <button
    onClick={onClick}
    className={cn(
      'h-12 cursor-pointer rounded-full border border-border bg-card px-5 text-[15px] font-semibold',
      'transition-colors hover:border-foreground/20 hover:bg-muted active:scale-[0.97]',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
    )}
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
