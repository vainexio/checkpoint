import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert.tsx';
import { formatElapsed } from '@/utils/time.js';

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
      <div className="flex items-start gap-2 border-t border-dashed border-border pt-3 text-[13px] text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>Last confirmed {elapsed} ago — this ETA may be out of date.</span>
      </div>
    );
  }

  return (
    <Alert className="border-dashed bg-muted/50">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>No update in {elapsed}</AlertTitle>
      <AlertDescription>
        {lastCheckpointName ? `The last confirmed point was ${lastCheckpointName}. ` : ''}
        The bus may be in an area without signal. Treat the time below as an estimate, not a
        live position.
      </AlertDescription>
    </Alert>
  );
}
