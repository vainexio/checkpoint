import { formatTime } from '../utils/time.js';
import './timeline.css';

/**
 * The route as a strip of checkpoints: what has been confirmed, what was passed
 * without a tap, and what is still projected ahead. This is where the
 * checkpoint-not-coordinates idea becomes legible — you can see exactly which
 * observations the ETA is built from.
 */
export function Timeline({ stops, lastConfirmedName }) {
  return (
    <ol className="timeline">
      {stops.map((stop) => {
        const isLandmark = stop.type === 'landmark';
        const isCurrent = stop.name === lastConfirmedName;

        return (
          <li
            key={stop.checkpointId}
            className={[
              'timeline__row',
              `timeline__row--${stop.progress}`,
              isCurrent ? 'timeline__row--current' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <div className="timeline__rail" aria-hidden="true">
              <span className="timeline__node" />
            </div>

            <div className="timeline__body">
              <div className="timeline__name">
                {stop.name}
                {isLandmark && <span className="timeline__tag">timing point</span>}
              </div>
              <div className="timeline__meta">
                {stop.progress === 'passed' && 'Confirmed'}
                {stop.progress === 'skipped' && 'Passed without a confirmation'}
                {stop.progress === 'pending' &&
                  (stop.baselineMinutesFromPrevious
                    ? `${stop.baselineMinutesFromPrevious} min from previous`
                    : 'Origin')}
              </div>
            </div>

            <div className="timeline__time">
              <span
                className={`mono ${stop.progress === 'pending' ? 'timeline__time--projected' : ''}`}
              >
                {formatTime(stop.actualArrival ?? stop.projectedArrival ?? stop.scheduledArrival)}
              </span>
              {stop.progress === 'pending' && (
                <span className="timeline__est">
                  {stop.projectedArrival ? 'est.' : 'scheduled'}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
