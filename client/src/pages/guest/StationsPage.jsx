import { Link } from 'react-router-dom';
import { usePolling } from '../../hooks/usePolling.js';
import { fetchRoutes, fetchStations } from '../../api/publicApi.js';
import './guest.css';

/**
 * The guest entry point: pick where you are waiting.
 *
 * No account, no download, no permission prompt. A passenger standing at a
 * terminal should be one tap from the board for that terminal.
 */
export default function StationsPage() {
  const stations = usePolling(fetchStations, { intervalMs: 120000 });
  const routes = usePolling(fetchRoutes, { intervalMs: 120000 });

  const terminals = (stations.data ?? []).filter((s) => s.isTerminal);
  const stops = (stations.data ?? []).filter((s) => !s.isTerminal);

  return (
    <div className="shell">
      <div className="pagehead">
        <div>
          <div className="eyebrow">Live bus arrivals</div>
          <h1 className="pagehead__title">Where are you waiting?</h1>
          <p className="pagehead__sub">
            Choose a stop to see every bus currently heading there, with a live
            arrival time for each.
          </p>
        </div>
      </div>

      {stations.error && (
        <div className="notice notice--error">
          Could not load stations. {stations.error.message}
        </div>
      )}

      {stations.loading && !stations.data && <div className="empty">Loading stops…</div>}

      {terminals.length > 0 && (
        <section className="stationgroup">
          <h2 className="eyebrow">Terminals</h2>
          <div className="grid grid--3">
            {terminals.map((station) => (
              <StationCard key={station.id} station={station} />
            ))}
          </div>
        </section>
      )}

      {stops.length > 0 && (
        <section className="stationgroup">
          <h2 className="eyebrow">Stops along the way</h2>
          <div className="grid grid--3">
            {stops.map((station) => (
              <StationCard key={station.id} station={station} />
            ))}
          </div>
        </section>
      )}

      {routes.data?.length > 0 && (
        <section className="stationgroup">
          <h2 className="eyebrow">Or browse by route</h2>
          <div className="grid grid--2">
            {routes.data.map((route) => (
              <div key={route.id} className="card routecard">
                <div className="routecard__name">{route.name}</div>
                <div className="routecard__path">
                  {route.origin} → {route.destination}
                  <span className="routecard__count">{route.stopCount} checkpoints</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StationCard({ station }) {
  return (
    <Link to={`/stations/${station.id}`} className="card stationcard">
      <span className="stationcard__name">{station.name}</span>
      <span className="stationcard__go" aria-hidden="true">
        →
      </span>
    </Link>
  );
}
