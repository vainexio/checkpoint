import { Badge } from '@/components/ui/badge.tsx';

/**
 * One vocabulary for trip state, in words a passenger already knows.
 *
 * Staleness outranks everything. A bus that has stopped reporting is not
 * "on time" and is not "delayed" — nobody knows what it is, so it says exactly
 * that rather than borrowing the colour of either.
 */
const LABELS = {
  scheduled: { text: 'Not yet departed', variant: 'secondary' },
  in_transit: { text: 'On time', variant: 'success' },
  delayed: { text: 'Running late', variant: 'warning' },
  arrived: { text: 'Arrived', variant: 'muted' },
  cancelled: { text: 'Cancelled', variant: 'destructive' },
};

/**
 * Matches DELAY_THRESHOLD_MINUTES on the server. Only used to decide whether
 * lateness is worth naming — the server owns the delayed/not decision itself.
 */
const WORTH_MENTIONING_MINUTES = 5;

export function StatusBadge({
  status,
  isStale,
  varianceMinutes,
  conditionsAllowanceMinutes = 0,
  className,
}) {
  if (isStale) {
    return (
      <Badge variant="muted" className={className}>
        No recent update
      </Badge>
    );
  }

  /**
   * Behind the timetable, but the road explains it.
   *
   * The server clears the delayed flag when traffic accounts for the loss,
   * which is right for judging the bus and wrong for the person waiting at the
   * stop — "On time" over a bus that is twelve minutes away is a lie they will
   * catch. So lateness is always stated; what the allowance changes is the
   * colour and the blame, not whether the number is shown.
   */
  if (
    status === 'in_transit' &&
    varianceMinutes >= WORTH_MENTIONING_MINUTES &&
    conditionsAllowanceMinutes > 0
  ) {
    return (
      <Badge variant="secondary" className={className}>
        {varianceMinutes} min late · traffic
      </Badge>
    );
  }

  const { text, variant } = LABELS[status] ?? LABELS.scheduled;
  const suffix =
    status === 'delayed' && varianceMinutes > 0
      ? ` by ${varianceMinutes} min`
      : status === 'in_transit' && varianceMinutes < 0
        ? ` · ${Math.abs(varianceMinutes)} min early`
        : '';

  return (
    <Badge variant={variant} className={className}>
      {text}
      {suffix}
    </Badge>
  );
}
