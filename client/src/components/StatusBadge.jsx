import { Badge } from '@/components/ui/badge.tsx';

/**
 * One vocabulary for trip state, used identically on all three screens.
 *
 * Staleness outranks everything. A bus that has stopped reporting is not
 * "on time" and is not "delayed" — nobody knows what it is, so it takes the
 * muted variant rather than borrowing the colour of either.
 */
const LABELS = {
  scheduled: { text: 'Scheduled', variant: 'secondary' },
  in_transit: { text: 'On time', variant: 'success' },
  delayed: { text: 'Delayed', variant: 'warning' },
  arrived: { text: 'Arrived', variant: 'muted' },
  cancelled: { text: 'Cancelled', variant: 'destructive' },
};

export function StatusBadge({ status, isStale, varianceMinutes, className }) {
  if (isStale) {
    return (
      <Badge variant="muted" className={className}>
        Unconfirmed
      </Badge>
    );
  }

  const { text, variant } = LABELS[status] ?? LABELS.scheduled;
  const suffix =
    status === 'delayed' && varianceMinutes > 0
      ? ` ${varianceMinutes} min`
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
