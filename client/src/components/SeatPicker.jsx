import { Armchair, TriangleAlert, Users } from 'lucide-react';
import { cn } from '@/lib/utils.ts';
import { formatTime } from '@/utils/time.js';

/**
 * The three answers to the only seat question a passenger actually has:
 * will I sit, will I get on, or should I stop waiting for this one.
 *
 * Deliberately not a count. A conductor on a moving bus can judge "full" in a
 * glance; counting free seats is a different job, and asking for it is how you
 * get an app nobody uses.
 */
export const LOAD_LEVELS = [
  {
    value: 'seats',
    label: 'Seats available',
    short: 'Seats',
    hint: 'Passengers will get a seat',
    icon: Armchair,
    tone: 'success',
  },
  {
    value: 'few',
    label: 'Filling up',
    short: 'Filling up',
    hint: 'They will get on, maybe standing',
    icon: Users,
    tone: 'warning',
  },
  {
    value: 'full',
    label: 'Full — not picking up',
    short: 'Full',
    hint: 'Tells people at the next stops not to wait',
    icon: TriangleAlert,
    tone: 'destructive',
  },
];

export const loadLevel = (value) => LOAD_LEVELS.find((l) => l.value === value) ?? null;

const TONES = {
  success: {
    on: 'border-success bg-success text-success-foreground',
    off: 'border-border hover:border-success/50 hover:bg-success/5',
  },
  warning: {
    on: 'border-warning bg-warning text-warning-foreground',
    off: 'border-border hover:border-warning/50 hover:bg-warning/5',
  },
  destructive: {
    on: 'border-destructive bg-destructive text-destructive-foreground',
    off: 'border-border hover:border-destructive/50 hover:bg-destructive/5',
  },
};

/**
 * Three big targets, no confirmation step.
 *
 * There is no confirm because there is nothing to lose: a wrong tap is fixed by
 * tapping the right one, and every report is undoable. Making a two-second,
 * reversible action ask "are you sure" is how a screen becomes tiring.
 */
export function SeatPicker({ value, onPick, disabled = false, compact = false }) {
  return (
    <div className={cn('grid gap-2', compact ? 'grid-cols-3' : 'grid-cols-1 sm:grid-cols-3')}>
      {LOAD_LEVELS.map((level) => {
        const Icon = level.icon;
        const selected = value === level.value;
        const tone = TONES[level.tone];

        return (
          <button
            key={level.value}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onPick(level.value)}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 px-3 py-3',
              'text-center transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              compact ? 'min-h-[64px]' : 'min-h-[84px]',
              selected ? tone.on : cn('bg-card', tone.off)
            )}
          >
            <Icon className={cn('shrink-0', compact ? 'h-4 w-4' : 'h-5 w-5')} />
            <span className={cn('font-bold leading-tight', compact ? 'text-[13px]' : 'text-[15px]')}>
              {compact ? level.short : level.label}
            </span>
            {!compact && <span className="text-[11px] opacity-80">{level.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** How the board tells a passenger what they are walking towards. */
/**
 * `showSource` exists because the attribution belongs wherever the badge is the
 * whole story, and gets in the way where it is one line among several. On a
 * board row the same "left Turbina, 01:05" was being printed three times over.
 */
export function SeatBadge({ load, reportedAtName, reportedAt, className, showSource = true }) {
  const level = loadLevel(load);
  if (!level) return null;

  const Icon = level.icon;
  const tone = {
    success: 'bg-success/15 text-success border-success/30',
    warning: 'bg-warning/20 text-warning-strong border-warning/40',
    destructive: 'bg-destructive/10 text-destructive border-destructive/30',
  }[level.tone];

  /*
   * The pill and its attribution are separate boxes, not one long string.
   *
   * Inline, a stop name as long as "Balintawak Interchange" dragged the pill
   * past the width of a phone and the label itself broke across two lines
   * inside its own border. Splitting them lets the pill stay whole and the
   * attribution wrap underneath, where a sentence is supposed to wrap.
   */
  return (
    <span className={cn('inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1', className)}>
      <span
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold',
          tone
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        {level.label}
      </span>

      {/* Attribution. A seat count is a judgement made somewhere, at a time —
          never a live measurement, and never presented as one. Suppressed only
          where the surrounding row already says where the bus last was. */}
      {showSource && reportedAtName && (
        <span className="text-[12px] font-medium text-muted-foreground">
          as it left {reportedAtName}
          {reportedAt && `, ${formatTime(reportedAt)}`}
        </span>
      )}
    </span>
  );
}
