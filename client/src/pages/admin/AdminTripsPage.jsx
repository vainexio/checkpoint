import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useList } from '../../hooks/useList.js';
import {
  createTrip,
  deleteTrip,
  listBuses,
  listConductors,
  listRoutes,
  listTrips,
  updateTrip,
} from '../../api/adminApi.js';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import {
  formatDateTime,
  formatVariance,
  fromManilaInputValue,
  toManilaInputValue,
} from '../../utils/time.js';
import './admin.css';

export default function AdminTripsPage() {
  const routes = useList(listRoutes);
  const buses = useList(listBuses);
  const conductors = useList(listConductors);
  const trips = useList(() => listTrips('?limit=60').then((r) => r.trips));

  const [form, setForm] = useState({
    routeId: '',
    busId: '',
    conductorId: '',
    scheduledDeparture: toManilaInputValue(new Date(Date.now() + 30 * 60000)),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createTrip({
        ...form,
        // The operator typed a Manila wall-clock time; send the real instant.
        scheduledDeparture: fromManilaInputValue(form.scheduledDeparture).toISOString(),
      });
      await trips.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn) => {
    try {
      await fn();
      await trips.reload();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="shell">
      <div className="pagehead">
        <div>
          <div className="eyebrow">Operations</div>
          <h1 className="pagehead__title">Trips</h1>
          <p className="pagehead__sub">
            Scheduling a trip copies the route's checkpoints and baseline times onto it.
            Editing the route later will not change a trip already created.
          </p>
        </div>
      </div>

      {(error || trips.error) && (
        <div className="notice notice--error">{(error ?? trips.error).message}</div>
      )}

      <form className="card" onSubmit={submit}>
        <div className="card__title">Schedule a trip</div>

        <div className="formgrid">
          <label className="field">
            <span className="field__label">Route</span>
            <select
              className="input"
              value={form.routeId}
              onChange={(e) => setForm({ ...form, routeId: e.target.value })}
              required
            >
              <option value="">Select…</option>
              {routes.items.map((r) => (
                <option key={r._id} value={r._id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">Bus</span>
            <select
              className="input"
              value={form.busId}
              onChange={(e) => setForm({ ...form, busId: e.target.value })}
              required
            >
              <option value="">Select…</option>
              {buses.items.map((b) => (
                <option key={b._id} value={b._id}>
                  {b.plateNumber}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">Conductor</span>
            <select
              className="input"
              value={form.conductorId}
              onChange={(e) => setForm({ ...form, conductorId: e.target.value })}
              required
            >
              <option value="">Select…</option>
              {conductors.items.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">Departure (Manila time)</span>
            <input
              className="input"
              type="datetime-local"
              value={form.scheduledDeparture}
              onChange={(e) => setForm({ ...form, scheduledDeparture: e.target.value })}
              required
            />
          </label>
        </div>

        <button className="btn btn--primary" disabled={busy}>
          {busy ? 'Scheduling…' : 'Schedule trip'}
        </button>
      </form>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card__title">
          All trips
          <span className="eyebrow">{trips.items.length}</span>
        </div>

        {trips.loading && <div className="empty">Loading…</div>}
        {!trips.loading && trips.items.length === 0 && (
          <div className="empty">No trips scheduled yet.</div>
        )}

        {trips.items.length > 0 && (
          <div className="table__scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Departure</th>
                  <th>Bus</th>
                  <th>Conductor</th>
                  <th>Status</th>
                  <th>Running</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {trips.items.map((trip) => (
                  <tr key={trip.id} className={trip.isStale ? 'row--stale' : ''}>
                    <td>
                      <Link to={`/trips/${trip.id}`} className="tablelink">
                        {trip.route.name}
                      </Link>
                    </td>
                    <td className="cell__sub">{formatDateTime(trip.scheduledDeparture)}</td>
                    <td className="mono">{trip.bus?.plateNumber ?? '—'}</td>
                    <td>{trip.conductor?.name ?? '—'}</td>
                    <td>
                      <StatusBadge
                        status={trip.status}
                        isStale={trip.isStale}
                        varianceMinutes={trip.varianceMinutes}
                      />
                    </td>
                    <td>{trip.actualDeparture ? formatVariance(trip.varianceMinutes) : '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {trip.status === 'scheduled' && (
                        <button
                          className="btn btn--sm"
                          onClick={() => act(() => updateTrip(trip.id, { status: 'cancelled' }))}
                        >
                          Cancel
                        </button>
                      )}{' '}
                      <button
                        className="btn btn--sm btn--danger"
                        onClick={() => act(() => deleteTrip(trip.id))}
                      >
                        Delete
                      </button>
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
