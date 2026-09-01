import { useState } from 'react';
import { useList } from '../../hooks/useList.js';
import {
  createCheckpoint,
  deleteCheckpoint,
  listCheckpoints,
} from '../../api/adminApi.js';
import './admin.css';

/**
 * Checkpoints are the vocabulary the whole system is built from. Stations get a
 * public board; landmarks exist purely to take a timing reading, which is why
 * the distinction is spelled out here rather than left as a dropdown label.
 */
export default function AdminCheckpointsPage() {
  const { items, error, loading, reload, setError } = useList(listCheckpoints);
  const [form, setForm] = useState({ name: '', type: 'station', isTerminal: false });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await createCheckpoint(form);
      setForm({ name: '', type: 'station', isTerminal: false });
      await reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    try {
      await deleteCheckpoint(id);
      await reload();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="shell">
      <div className="pagehead">
        <div>
          <div className="eyebrow">Setup</div>
          <h1 className="pagehead__title">Checkpoints</h1>
          <p className="pagehead__sub">
            The points a conductor can confirm. Encoded once, reused by every route
            that passes them.
          </p>
        </div>
      </div>

      {error && <div className="notice notice--error">{error.message}</div>}

      <div className="adminsplit">
        <form className="card" onSubmit={submit}>
          <div className="card__title">Add a checkpoint</div>

          <label className="field">
            <span className="field__label">Name</span>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Balintawak"
              required
            />
          </label>

          <label className="field">
            <span className="field__label">Type</span>
            <select
              className="input"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              <option value="station">Station — passengers board, gets a public board</option>
              <option value="landmark">Landmark — timing point only</option>
            </select>
          </label>

          <label className="checkline">
            <input
              type="checkbox"
              checked={form.isTerminal}
              onChange={(e) => setForm({ ...form, isTerminal: e.target.checked })}
            />
            <span>This is an official terminal</span>
          </label>

          <button className="btn btn--primary btn--block" disabled={busy}>
            {busy ? 'Adding…' : 'Add checkpoint'}
          </button>
        </form>

        <div className="card">
          <div className="card__title">
            All checkpoints
            <span className="eyebrow">{items.length}</span>
          </div>

          {loading && <div className="empty">Loading…</div>}

          {!loading && items.length === 0 && (
            <div className="empty">No checkpoints yet. Add the first one.</div>
          )}

          {items.length > 0 && (
            <div className="table__scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((cp) => (
                    <tr key={cp._id}>
                      <td>
                        {cp.name}
                        {cp.isTerminal && <span className="pill">Terminal</span>}
                      </td>
                      <td>
                        <span className={`typetag typetag--${cp.type}`}>{cp.type}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn--sm btn--danger" onClick={() => remove(cp._id)}>
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
    </div>
  );
}
