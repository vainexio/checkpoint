import { formatElapsed } from '../utils/time.js';

/**
 * The honest-about-staleness rule, made visible.
 *
 * When updates stop, the ETA does not disappear — a rough number still beats
 * nothing — but it stops being presented as fact. The number greys out and this
 * notice says exactly how long it has been since anyone confirmed anything, so
 * a passenger can decide for themselves how much to trust it.
 */
export function StaleNotice({ minutesSinceLastConfirm, lastCheckpointName, compact = false }) {
  const elapsed = formatElapsed(minutesSinceLastConfirm);

  if (compact) {
    return (
      <div className="notice notice--stale" role="status">
        <span aria-hidden="true">⚠</span>
        <span>
          Last confirmed {elapsed} ago — this ETA may be out of date.
        </span>
      </div>
    );
  }

  return (
    <div className="notice notice--stale" role="status">
      <span aria-hidden="true">⚠</span>
      <span>
        <strong>No update in {elapsed}.</strong>{' '}
        {lastCheckpointName
          ? `The last confirmed point was ${lastCheckpointName}. `
          : ''}
        The bus may be in an area without signal. Treat the time below as an
        estimate, not a live position.
      </span>
    </div>
  );
}
