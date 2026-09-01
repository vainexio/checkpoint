import { Link, useParams } from 'react-router-dom';
import { usePolling, useNow } from '../../hooks/usePolling.js';
import { fetchStationBoard } from '../../api/publicApi.js';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { LiveIndicator } from '../../components/Masthead.jsx';
import {
  formatCountdown,
  formatElapsed,
  formatTime,
  relativeMinutes,
} from '../../utils/time.js';
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
 * The arrivals board for one station: every bus heading here, soonest first.
 *
 * The ETA is the largest thing on the screen because it is the only thing most
 * people came for. Everything else — the route, the plate, where it was last
 * confirmed — is supporting evidence for that one number.
 */
export default function StationBoardPage() {
  const { stationId } = useParams();
  const now = useNow(20000);

  const { data, error, loading, lastUpdated } = usePolling(
    () => fetchStationBoard(stationId),
    { intervalMs: 15000, deps: [stationId] }
  );

  const arrivals = data?.arrivals ?? [];

  return (
    <div className="shell">
      <div className="pagehead">
        <div>
          <Link to="/" className="backlink">
            ← All stops
          </Link>
          <div className="eyebrow" style={{ marginTop: 12 }}>
            Arrivals
          </div>
          <h1 className="pagehead__title">{data?.station?.name ?? 'Loading…'}</h1>
        </div>
        <LiveIndicator lastUpdated={lastUpdated} />
      </div>

      {error && (
        <div className="notice notice--error">Could not load this board. {error.message}</div>
      )}

      {loading && !data && <div className="empty">Checking for buses…</div>}

      {data && arrivals.length === 0 && (
        <div className="empty">
          <p style={{ fontSize: 17, marginBottom: 8 }}>No buses currently heading here.</p>
          <p>Trips appear on this board once they are scheduled or under way.</p>
        </div>
      )}

      <div className="board">
        {arrivals.map((arrival) => (
          <ArrivalRow key={arrival.tripId} arrival={arrival} now={now} />
        ))}
      </div>
    </div>
  );
}

function ArrivalRow({ arrival, now }) {
  const minutesAway = relativeMinutes(arrival.eta, now);
  const notDepartedYet = arrival.status === 'scheduled';

  return (
    <Link to={`/trips/${arrival.tripId}`} className="arrival">
      <div className="arrival__main">
        <div className="arrival__route">{arrival.route}</div>
        <div className="arrival__path">
          {arrival.origin} → {arrival.destination}
        </div>

        <div className="arrival__tags">
          <StatusBadge
            status={arrival.status}
            isStale={arrival.isStale}
            varianceMinutes={arrival.varianceMinutes}
          />
          {arrival.bus && <span className="arrival__plate mono">{arrival.bus.plateNumber}</span>}
        </div>

        <div className="arrival__confirm">
          {notDepartedYet ? (
            <>Departs {formatTime(arrival.scheduledDeparture)} from {arrival.origin}</>
          ) : arrival.lastConfirmedCheckpoint ? (
            <>
              Last confirmed at <strong>{arrival.lastConfirmedCheckpoint.name}</strong>
              {arrival.minutesSinceLastConfirm !== null && (
                <> · {formatElapsed(arrival.minutesSinceLastConfirm)} ago</>
              )}
              {arrival.stopsAway > 1 && <> · {arrival.stopsAway} stops away</>}
            </>
          ) : (
            'Not yet departed'
          )}
        </div>

        {arrival.latestDelay && !arrival.isStale && (
          <div className="arrival__delay">
            Conductor reported {DELAY_TEXT[arrival.latestDelay.reason] ?? 'a delay'}
            {arrival.latestDelay.nearCheckpoint && <> near {arrival.latestDelay.nearCheckpoint}</>}
            , {formatTime(arrival.latestDelay.reportedAt)}
          </div>
        )}
      </div>

      <div className="arrival__eta">
        <div
          className={`eta eta--hero ${arrival.isStale || notDepartedYet ? 'eta--stale' : ''}`}
        >
          {formatTime(notDepartedYet ? arrival.scheduledEta : arrival.eta)}
        </div>
        <div className="arrival__countdown">
          {notDepartedYet
            ? 'scheduled'
            : arrival.isStale
              ? 'estimate only'
              : minutesAway !== null && minutesAway > 1
                ? formatCountdown(arrival.eta, now)
                : 'arriving'}
        </div>
      </div>

      {arrival.isStale && (
        <div className="arrival__stale">
          ⚠ No update in {formatElapsed(arrival.minutesSinceLastConfirm)} — this time may be out of
          date.
        </div>
      )}
    </Link>
  );
}
