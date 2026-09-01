import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePolling } from '../../hooks/usePolling.js';
import { useOfflineQueue } from '../../hooks/useOfflineQueue.js';
import { fetchMyTrip } from '../../api/conductorApi.js';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { Timeline } from '../../components/Timeline.jsx';
import { formatTime, formatVariance } from '../../utils/time.js';
import './conductor.css';

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

  if (error) {
    return (
      <div className="shell shell--narrow">
        <div className="notice notice--error" style={{ marginTop: 24 }}>
          {error.message}
        </div>
        <p style={{ marginTop: 16 }}>
          <Link to="/conductor" className="backlink">
            ← Your trips
          </Link>
        </p>
      </div>
    );
  }

  if (loading && !trip) {
    return (
      <div className="shell shell--narrow">
        <div className="empty">Loading trip…</div>
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
    <div className="shell shell--narrow conductor">
      <div className="pagehead">
        <div>
          <Link to="/conductor" className="backlink">
            ← Your trips
          </Link>
          <h1 className="pagehead__title" style={{ marginTop: 12 }}>
            {trip.route.name}
          </h1>
          <p className="pagehead__sub">
            {trip.bus?.plateNumber} · departs {formatTime(trip.scheduledDeparture)}
          </p>
        </div>
      </div>

      <QueueBanner
        pendingCount={pendingCount}
        isOnline={isOnline}
        isSyncing={isSyncing}
        onRetry={flush}
      />

      {confirmation && (
        <div className="confirm" role="status">
          <span className="confirm__tick" aria-hidden="true">
            ✓
          </span>
          <div>
            <strong>{confirmation.message}</strong>
            <div className="confirm__time">Recorded at {formatTime(confirmation.at)}</div>
          </div>
        </div>
      )}

      <div className="card statuscard">
        <div>
          <StatusBadge
            status={trip.status}
            isStale={trip.isStale}
            varianceMinutes={trip.varianceMinutes}
          />
          <div className="statuscard__variance">{formatVariance(trip.varianceMinutes)}</div>
        </div>
        <div className="statuscard__last">
          <div className="fact__label">Last confirmed</div>
          <div className="fact__value">{trip.lastConfirmedCheckpoint?.name ?? '—'}</div>
          {trip.lastConfirmedAt && (
            <div className="confirm__time">{formatTime(trip.lastConfirmedAt)}</div>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------------- actions */}
      {!finished && (
        <div className="actions">
          {notDeparted ? (
            <button
              className="tapbtn tapbtn--primary"
              onClick={() => tap({ type: 'departed' }, 'Departure recorded')}
            >
              <span className="tapbtn__label">Depart now</span>
              <span className="tapbtn__sub">Starts the clock for this trip</span>
            </button>
          ) : (
            <>
              {nextStop && nextStop.checkpointId !== destination?.checkpointId && (
                <button
                  className="tapbtn tapbtn--primary"
                  onClick={() =>
                    tap(
                      { type: 'passed_checkpoint', checkpoint: nextStop.checkpointId },
                      `Passed ${nextStop.name}`
                    )
                  }
                >
                  <span className="tapbtn__label">Passed {nextStop.name}</span>
                  <span className="tapbtn__sub">Next checkpoint on this route</span>
                </button>
              )}

              <button
                className="tapbtn"
                onClick={() =>
                  tap({ type: 'arrived' }, `Arrival at ${destination?.name} recorded`)
                }
              >
                <span className="tapbtn__label">Arrived at {destination?.name}</span>
                <span className="tapbtn__sub">Ends the trip</span>
              </button>

              {remainingStops.length > 1 && (
                <button
                  className="btn btn--ghost btn--block"
                  onClick={() => setShowAllStops((v) => !v)}
                >
                  {showAllStops ? 'Hide other checkpoints' : 'Passed a different checkpoint'}
                </button>
              )}

              {showAllStops && (
                <div className="chiprow">
                  {remainingStops
                    .filter((s) => s.checkpointId !== destination?.checkpointId)
                    .map((stop) => (
                      <button
                        key={stop.checkpointId}
                        className="chip"
                        onClick={() =>
                          tap(
                            { type: 'passed_checkpoint', checkpoint: stop.checkpointId },
                            `Passed ${stop.name}`
                          )
                        }
                      >
                        {stop.name}
                      </button>
                    ))}
                </div>
              )}
            </>
          )}

          {!notDeparted && (
            <>
              <button className="btn btn--ghost btn--block" onClick={() => setShowDelay((v) => !v)}>
                {showDelay ? 'Cancel' : 'Report a delay'}
              </button>

              {showDelay && (
                <div className="chiprow">
                  {DELAY_REASONS.map((reason) => (
                    <button
                      key={reason.value}
                      className="chip"
                      onClick={() =>
                        tap(
                          { type: 'delayed', delayReason: reason.value },
                          `Delay reported: ${reason.label.toLowerCase()}`
                        )
                      }
                    >
                      {reason.label}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {finished && (
        <div className="notice notice--info" style={{ marginBottom: 16 }}>
          This trip is {trip.status}. No further updates are needed.
        </div>
      )}

      <div className="card">
        <div className="card__title">Route</div>
        <Timeline stops={trip.stops} lastConfirmedName={trip.lastConfirmedCheckpoint?.name} />
      </div>
    </div>
  );
}

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
      <div className="queuebar queuebar--offline">
        <span className="queuebar__dot" />
        <span>No connection. Your taps will still be recorded.</span>
      </div>
    );
  }

  return (
    <div className="queuebar">
      <span className="queuebar__dot" />
      <span>
        <strong>
          {pendingCount} update{pendingCount === 1 ? '' : 's'} waiting to send.
        </strong>{' '}
        {isSyncing
          ? 'Sending now…'
          : isOnline
            ? 'Will send automatically.'
            : 'They will send as soon as there is signal.'}
      </span>
      {isOnline && !isSyncing && (
        <button className="btn btn--sm btn--ghost" onClick={onRetry}>
          Try now
        </button>
      )}
    </div>
  );
}
