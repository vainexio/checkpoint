import { motion } from 'framer-motion';
import { cn } from '@/lib/utils.ts';

/**
 * A pill of choices with the selection sliding between them.
 *
 * The slide is the whole point. A tab that simply swaps which pill is filled
 * makes the eye re-find the selection each time; one that travels carries the
 * eye with it, so you know what changed without reading anything. Framer's
 * shared layout id does the movement, which means it also lands correctly when
 * the pills are different widths.
 */
export function SegmentedTabs({ options, value, onChange, className }) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-secondary p-1',
        className
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors',
              active ? 'text-primary-foreground' : 'text-secondary-foreground hover:text-foreground'
            )}
          >
            {active && (
              <motion.span
                layoutId="segmented-active"
                className="absolute inset-0 rounded-full bg-primary"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative z-10 whitespace-nowrap">
              {option.label}
              {option.count !== undefined && (
                <span className={cn('ml-1.5 tabular', active ? 'opacity-80' : 'opacity-60')}>
                  {option.count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
