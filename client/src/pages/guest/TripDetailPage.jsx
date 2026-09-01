import { Link, useParams } from 'react-router-dom';
import { usePolling, useNow } from '../../hooks/usePolling.js';
import { fetchTrip } from '../../api/publicApi.js';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { StaleNotice } from '../../components/StaleNotice.jsx';
import { Timeline } from '../../components/Timeline.jsx';
import { LiveIndicator } from '../../components/Masthead.jsx';
import { formatCountdown, formatDay, formatTime, formatVariance } from '../../utils/time.js';
import './guest.css';

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

  if (error) {
    return (
      <div className="shell shell--narrow">
        <div className="pagehead">
          <Link to="/" className="backlink">
            ← All stops
          </Link>
        </div>
        <div className="notice notice--error">Could not load this trip. {error.message}</div>
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

  const destination = trip.stops.at(-1);
  const notDepartedYet = !trip.actualDeparture;
  const arrivalTime =
    destination?.actualArrival ?? destination?.projectedArrival ?? destination?.scheduledArrival;

  return (
    <div className="shell shell--narrow">
      <div className="pagehead">
        <div>
          <Link to="/" className="backlink">
            ← All stops
          </Link>
          <div className="eyebrow" style={{ marginTop: 12 }}>
            {formatDay(trip.scheduledDeparture)}
          </div>
          <h1 className="pagehead__title">{trip.route.name}</h1>
          <p className="pagehead__sub">
            {trip.bus ? `${trip.bus.plateNumber} · ${trip.bus.operatorName}` : 'Bus to be assigned'}
          </p>
        </div>
        <LiveIndicator lastUpdated={lastUpdated} />
      </div>

      <div className="stack">
        {trip.isStale && (
          <StaleNotice
            minutesSinceLastConfirm={trip.minutesSinceLastConfirm}
            lastCheckpointName={trip.lastConfirmedCheckpoint?.name}
          />
        )}

        {trip.latestDelay && !trip.isStale && (
          <div className="notice notice--delay">
            <span aria-hidden="true">●</span>
            <span>
              Conductor reported {DELAY_TEXT[trip.latestDelay.reason] ?? 'a delay'}
              {trip.latestDelay.nearCheckpoint && <> near {trip.latestDelay.nearCheckpoint}</>}, at{' '}
              {formatTime(trip.latestDelay.reportedAt)}. The arrival time below still reflects the
              last confirmed checkpoint.
            </span>
          </div>
        )}

        <div className="triphero">
          <div>
            <div className="triphero__label">
              {trip.status === 'arrived' ? 'Arrived at' : 'Arriving at'} {destination?.name}
            </div>
            <StatusBadge
              status={trip.status}
              isStale={trip.isStale}
              varianceMinutes={trip.varianceMinutes}
            />
          </div>
          <div className="triphero__eta">
            <div className={`eta eta--hero ${trip.isStale || notDepartedYet ? 'eta--stale' : ''}`}>
              {formatTime(arrivalTime)}
            </div>
            {trip.status !== 'arrived' && (
              <div className="relative-time">
                {notDepartedYet ? 'scheduled — not departed yet' : formatCountdown(arrivalTime, now)}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="factgrid">
            <div>
              <div className="fact__label">Scheduled departure</div>
              <div className="fact__value mono">{formatTime(trip.scheduledDeparture)}</div>
            </div>
            <div>
              <div className="fact__label">Actual departure</div>
              <div className="fact__value mono">
                {trip.actualDeparture ? formatTime(trip.actualDeparture) : 'Not yet'}
              </div>
            </div>
            <div>
              <div className="fact__label">Running</div>
              <div className="fact__value">{formatVariance(trip.varianceMinutes)}</div>
            </div>
            <div>
              <div className="fact__label">Last confirmed</div>
              <div className="fact__value">
                {trip.lastConfirmedCheckpoint?.name ?? 'Not departed'}
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card__title">
            Checkpoints
            <span className="eyebrow">{trip.stops.length} points</span>
          </div>
          <Timeline stops={trip.stops} lastConfirmedName={trip.lastConfirmedCheckpoint?.name} />
        </div>

        <p className="arrival__confirm" style={{ textAlign: 'center' }}>
          Times are estimates based on confirmed checkpoints and this route's usual
          segment times. Shown in Manila time.
        </p>
      </div>
    </div>
  );
}
