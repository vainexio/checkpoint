import { Link } from 'react-router-dom';
import { usePolling } from '../../hooks/usePolling.js';
import { fetchMyTrips } from '../../api/conductorApi.js';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { formatDay, formatTime } from '../../utils/time.js';
import './conductor.css';

/** A conductor sees their own trips and nothing else. */
export default function ConductorTripsPage({ user }) {
  const { data, error, loading } = usePolling(fetchMyTrips, { intervalMs: 30000 });
  const trips = data?.trips ?? [];

  return (
    <div className="shell shell--narrow">
      <div className="pagehead">
        <div>
          <div className="eyebrow">Signed in as {user?.name}</div>
          <h1 className="pagehead__title">Your trips</h1>
        </div>
      </div>

      {error && <div className="notice notice--error">{error.message}</div>}
      {loading && !data && <div className="empty">Loading your trips…</div>}

      {data && trips.length === 0 && (
        <div className="empty">
          <p style={{ fontSize: 17, marginBottom: 8 }}>No trips assigned to you right now.</p>
          <p>Your dispatcher will assign one before departure.</p>
        </div>
      )}

      <div className="stack">
        {trips.map((trip) => (
          <Link key={trip.id} to={`/conductor/trips/${trip.id}`} className="card triptile">
            <div>
              <div className="triptile__route">{trip.route.name}</div>
              <div className="triptile__meta">
                {formatDay(trip.scheduledDeparture)} · departs{' '}
                {formatTime(trip.scheduledDeparture)}
                {trip.bus && <> · {trip.bus.plateNumber}</>}
              </div>
              <div style={{ marginTop: 10 }}>
                <StatusBadge
                  status={trip.status}
                  isStale={trip.isStale}
                  varianceMinutes={trip.varianceMinutes}
                />
              </div>
            </div>
            <span className="triptile__go" aria-hidden="true">
              →
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
