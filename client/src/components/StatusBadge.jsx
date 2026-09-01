/**
 * One vocabulary for trip state, used identically on all three screens.
 *
 * Staleness outranks everything. A bus that has stopped reporting is not
 * "on time" and is not "delayed" — nobody knows what it is, and the badge has
 * to say that rather than pick the more flattering of the two.
 */
const LABELS = {
  scheduled: { text: 'Scheduled', tone: 'scheduled' },
  in_transit: { text: 'On time', tone: 'ontime' },
  delayed: { text: 'Delayed', tone: 'delayed' },
  arrived: { text: 'Arrived', tone: 'arrived' },
  cancelled: { text: 'Cancelled', tone: 'stale' },
};

export function StatusBadge({ status, isStale, varianceMinutes }) {
  if (isStale) {
    return (
      <span className="badge badge--stale">
        <span className="badge__dot" />
        Unconfirmed
      </span>
    );
  }

  const { text, tone } = LABELS[status] ?? LABELS.scheduled;
  const suffix =
    status === 'delayed' && varianceMinutes > 0
      ? ` ${varianceMinutes} min`
      : status === 'in_transit' && varianceMinutes < 0
        ? ` ${Math.abs(varianceMinutes)} min early`
        : '';

  return (
    <span className={`badge badge--${tone}`}>
      <span className="badge__dot" />
      {text}
      {suffix}
    </span>
  );
}
