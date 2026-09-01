import { Link } from 'react-router-dom';
import { usePolling } from '../../hooks/usePolling.js';
import { fetchDashboard } from '../../api/adminApi.js';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { LiveIndicator } from '../../components/Masthead.jsx';
import { formatElapsed, formatTime, formatVariance } from '../../utils/time.js';
import './admin.css';

/**
 * The operator's view of the whole system. The counts across the top are
 * deliberately not just a trip census: "not reporting" sits alongside them
 * because a silent bus is an operational problem of a different kind from a
 * late one, and it is the one nobody notices without being told.
 */
export default function AdminDashboardPage() {
  const { data, error, loading, lastUpdated } = usePolling(fetchDashboard, { intervalMs: 15000 });

  const counts = data?.counts;
  const trips = data?.trips ?? [];

  return (
    <div className="shell">
      <div className="pagehead">
        <div>
          <div className="eyebrow">Operations</div>
          <h1 className="pagehead__title">Today's trips</h1>
        </div>
        <LiveIndicator lastUpdated={lastUpdated} />
      </div>

      {error && <div className="notice notice--error">{error.message}</div>}

      {counts && (
        <div className="statrow">
          <Stat label="Active" value={counts.active} />
          <Stat label="In transit" value={counts.inTransit} tone="ontime" />
          <Stat label="Delayed" value={counts.delayed} tone="delayed" />
          <Stat label="Not reporting" value={counts.stale} tone="stale" />
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card__title">
          Active trips
          <span className="eyebrow">{trips.length} total</span>
        </div>

        {loading && !data && <div className="empty">Loading…</div>}

        {data && trips.length === 0 && (
          <div className="empty">
            No active trips. <Link to="/admin/trips">Schedule one →</Link>
          </div>
        )}

        {trips.length > 0 && (
          <div className="table__scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Bus</th>
                  <th>Conductor</th>
                  <th>Status</th>
                  <th>Last confirmed</th>
                  <th>Running</th>
                  <th>Arrival</th>
                </tr>
              </thead>
              <tbody>
                {trips.map((trip) => (
                  <tr key={trip.id} className={trip.isStale ? 'row--stale' : ''}>
                    <td>
                      <Link to={`/trips/${trip.id}`} className="tablelink">
                        {trip.route.name}
                      </Link>
                      <div className="cell__sub">
                        departs {formatTime(trip.scheduledDeparture)}
                      </div>
                    </td>
                    <td className="mono">{trip.bus?.plateNumber ?? '—'}</td>
                    <td>{trip.conductor?.name ?? '—'}</td>
                    <td>
                      <StatusBadge
                        status={trip.status}
                        isStale={trip.isStale}
                        varianceMinutes={trip.varianceMinutes}
                      />
                    </td>
                    <td>
                      {trip.lastConfirmedCheckpoint?.name ?? '—'}
                      {trip.minutesSinceLastConfirm !== null && (
                        <div className="cell__sub">
                          {formatElapsed(trip.minutesSinceLastConfirm)} ago
                        </div>
                      )}
                    </td>
                    <td>{formatVariance(trip.varianceMinutes)}</td>
                    <td className="mono">
                      {formatTime(trip.stops.at(-1)?.projectedArrival)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className="card stat">
      <div className="fact__label">{label}</div>
      <div className={`stat__value ${tone ? `stat__value--${tone}` : ''}`}>{value}</div>
    </div>
  );
}
