import { useState } from 'react';
import { useList } from '../../hooks/useList.js';
import {
  createBus,
  createConductor,
  deleteBus,
  deleteConductor,
  listBuses,
  listConductors,
} from '../../api/adminApi.js';
import './admin.css';

/** Buses and the people on them — the two things a trip needs assigned to it. */
export default function AdminFleetPage() {
  const buses = useList(listBuses);
  const conductors = useList(listConductors);
  const [error, setError] = useState(null);

  return (
    <div className="shell">
      <div className="pagehead">
        <div>
          <div className="eyebrow">Setup</div>
          <h1 className="pagehead__title">Fleet &amp; crew</h1>
        </div>
      </div>

      {error && <div className="notice notice--error">{error.message}</div>}

      <div className="adminsplit adminsplit--even">
        <BusPanel buses={buses} onError={setError} />
        <ConductorPanel conductors={conductors} onError={setError} />
      </div>
    </div>
  );
}

function BusPanel({ buses, onError }) {
  const [form, setForm] = useState({ plateNumber: '', operatorName: '' });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await createBus(form);
      setForm({ plateNumber: '', operatorName: '' });
      await buses.reload();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card__title">
        Buses
        <span className="eyebrow">{buses.items.length}</span>
      </div>

      <form onSubmit={submit} className="inlineform">
        <div className="formgrid">
          <label className="field">
            <span className="field__label">Plate number</span>
            <input
              className="input"
              value={form.plateNumber}
              onChange={(e) => setForm({ ...form, plateNumber: e.target.value })}
              placeholder="NRT 8821"
              required
            />
          </label>
          <label className="field">
            <span className="field__label">Operator</span>
            <input
              className="input"
              value={form.operatorName}
              onChange={(e) => setForm({ ...form, operatorName: e.target.value })}
              placeholder="Northline Express"
              required
            />
          </label>
        </div>
        <button className="btn btn--primary btn--sm" disabled={busy}>
          {busy ? 'Adding…' : 'Add bus'}
        </button>
      </form>

      {buses.items.length === 0 ? (
        <div className="empty">No buses yet.</div>
      ) : (
        <table className="table">
          <tbody>
            {buses.items.map((bus) => (
              <tr key={bus._id}>
                <td className="mono">{bus.plateNumber}</td>
                <td className="cell__sub">{bus.operatorName}</td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    className="btn btn--sm btn--danger"
                    onClick={async () => {
                      try {
                        await deleteBus(bus._id);
                        await buses.reload();
                      } catch (err) {
                        onError(err);
                      }
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ConductorPanel({ conductors, onError }) {
  const [form, setForm] = useState({ name: '', username: '', password: '' });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await createConductor(form);
      setForm({ name: '', username: '', password: '' });
      await conductors.reload();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card__title">
        Conductors
        <span className="eyebrow">{conductors.items.length}</span>
      </div>

      <form onSubmit={submit} className="inlineform">
        <div className="formgrid">
          <label className="field">
            <span className="field__label">Name</span>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </label>
          <label className="field">
            <span className="field__label">Username</span>
            <input
              className="input"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              autoCapitalize="none"
              required
            />
          </label>
        </div>
        <label className="field">
          <span className="field__label">Temporary password (min 8 characters)</span>
          <input
            className="input"
            type="text"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            minLength={8}
            required
          />
        </label>
        <button className="btn btn--primary btn--sm" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>

      {conductors.items.length === 0 ? (
        <div className="empty">No conductor accounts yet.</div>
      ) : (
        <table className="table">
          <tbody>
            {conductors.items.map((c) => (
              <tr key={c._id}>
                <td>
                  {c.name}
                  <div className="cell__sub mono">{c.username}</div>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    className="btn btn--sm btn--danger"
                    onClick={async () => {
                      try {
                        await deleteConductor(c._id);
                        await conductors.reload();
                      } catch (err) {
                        onError(err);
                      }
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
