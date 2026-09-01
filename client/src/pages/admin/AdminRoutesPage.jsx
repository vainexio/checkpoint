import { useState } from 'react';
import { useList } from '../../hooks/useList.js';
import {
  createRoute,
  deleteRoute,
  listCheckpoints,
  listRoutes,
} from '../../api/adminApi.js';
import './admin.css';

const emptyRow = () => ({ checkpoint: '', baselineMinutesFromPrevious: '' });

/**
 * The route builder — the "set once, run every trip" step from the pitch.
 *
 * Baselines are entered per segment because that is how an operator actually
 * knows a route: how long Balintawak to Tarlac usually takes, not what time a
 * bus reaches Tarlac. The running total is shown as you type, since that is the
 * number an operator can sanity-check against experience.
 */
export default function AdminRoutesPage() {
  const routes = useList(listRoutes);
  const checkpoints = useList(listCheckpoints);

  const [name, setName] = useState('');
  const [rows, setRows] = useState([emptyRow(), emptyRow()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const total = rows.reduce((sum, r) => sum + (Number(r.baselineMinutesFromPrevious) || 0), 0);

  const setRow = (index, patch) =>
    setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);

    const filled = rows.filter((r) => r.checkpoint);
    if (filled.length < 2) {
      setError(new Error('A route needs at least an origin and a destination.'));
      return;
    }

    setBusy(true);
    try {
      await createRoute({
        name,
        checkpoints: filled.map((r, i) => ({
          checkpoint: r.checkpoint,
          // The origin has nothing before it, so its baseline is always zero.
          baselineMinutesFromPrevious: i === 0 ? 0 : Number(r.baselineMinutesFromPrevious) || 0,
        })),
      });
      setName('');
      setRows([emptyRow(), emptyRow()]);
      await routes.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    try {
      await deleteRoute(id);
      await routes.reload();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="shell">
      <div className="pagehead">
        <div>
          <div className="eyebrow">Setup</div>
          <h1 className="pagehead__title">Routes</h1>
          <p className="pagehead__sub">
            An ordered chain of checkpoints with the usual travel time between each.
            This baseline is what every trip on the route is measured against.
          </p>
        </div>
      </div>

      {(error || routes.error) && (
        <div className="notice notice--error">{(error ?? routes.error).message}</div>
      )}

      <form className="card" onSubmit={submit}>
        <div className="card__title">
          New route
          {total > 0 && (
            <span className="eyebrow">
              {Math.floor(total / 60)}h {total % 60}m end to end
            </span>
          )}
        </div>

        <label className="field">
          <span className="field__label">Route name</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Cubao – Baguio"
            required
          />
        </label>

        <div className="field__label">Checkpoints, in order</div>
        <div className="routerows">
          {rows.map((row, index) => (
            <div key={index} className="routerow">
              <span className="routerow__index">{index + 1}</span>

              <select
                className="input"
                value={row.checkpoint}
                onChange={(e) => setRow(index, { checkpoint: e.target.value })}
              >
                <option value="">Select a checkpoint…</option>
                {checkpoints.items.map((cp) => (
                  <option key={cp._id} value={cp._id}>
                    {cp.name}
                    {cp.type === 'landmark' ? ' (landmark)' : ''}
                  </option>
                ))}
              </select>

              {index === 0 ? (
                <span className="routerow__origin">origin</span>
              ) : (
                <div className="routerow__mins">
                  <input
                    className="input"
                    type="number"
                    min="0"
                    value={row.baselineMinutesFromPrevious}
                    onChange={(e) =>
                      setRow(index, { baselineMinutesFromPrevious: e.target.value })
                    }
                    placeholder="0"
                  />
                  <span>min from previous</span>
                </div>
              )}

              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => setRows(rows.filter((_, i) => i !== index))}
                disabled={rows.length <= 2}
                aria-label={`Remove checkpoint ${index + 1}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="rowactions">
          <button type="button" className="btn btn--sm" onClick={() => setRows([...rows, emptyRow()])}>
            + Add checkpoint
          </button>
          <button className="btn btn--primary" disabled={busy}>
            {busy ? 'Saving…' : 'Create route'}
          </button>
        </div>
      </form>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card__title">
          Existing routes
          <span className="eyebrow">{routes.items.length}</span>
        </div>

        {routes.loading && <div className="empty">Loading…</div>}
        {!routes.loading && routes.items.length === 0 && (
          <div className="empty">No routes yet.</div>
        )}

        <div className="stack">
          {routes.items.map((route) => {
            const mins = route.checkpoints.reduce(
              (s, c) => s + (c.baselineMinutesFromPrevious || 0),
              0
            );
            return (
              <div key={route._id} className="routeblock">
                <div className="routeblock__head">
                  <div>
                    <div className="routeblock__name">{route.name}</div>
                    <div className="cell__sub">
                      {route.checkpoints.length} checkpoints · {Math.floor(mins / 60)}h {mins % 60}m
                      baseline
                    </div>
                  </div>
                  <button className="btn btn--sm btn--danger" onClick={() => remove(route._id)}>
                    Delete
                  </button>
                </div>

                <div className="chain">
                  {route.checkpoints.map((entry, i) => (
                    <span key={entry.checkpoint?._id ?? i} className="chain__item">
                      {i > 0 && (
                        <span className="chain__gap">{entry.baselineMinutesFromPrevious}m</span>
                      )}
                      <span
                        className={`chain__node ${
                          entry.checkpoint?.type === 'landmark' ? 'chain__node--landmark' : ''
                        }`}
                      >
                        {entry.checkpoint?.name ?? 'Unknown'}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
