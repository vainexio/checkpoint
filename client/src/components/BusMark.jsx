import { motion, useReducedMotion } from 'framer-motion';
import { Bus } from 'lucide-react';
import { cn } from '@/lib/utils.ts';

/**
 * The bus that drives into an arrivals row.
 *
 * It enters from the right as the row lands, then settles behind the countdown
 * as a watermark. Decoration, but decoration that says what the row is about —
 * a passenger scanning a list of times should never have to work out what kind
 * of thing is arriving.
 *
 * Kept faint deliberately: the countdown sits on top of it, and a watermark
 * that competes with the number it sits behind has stopped being a watermark.
 */
const TONES = {
  default: 'text-primary/[0.11]',
  go: 'text-success/[0.16]',
  stop: 'text-destructive/[0.14]',
};

export function BusMark({ tone = 'default' }) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      className="pointer-events-none absolute inset-y-0 right-0 z-0 flex items-center overflow-hidden"
      aria-hidden
      initial={reduced ? false : { x: 56, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: 0.06 }}
    >
      <Bus
        className={cn(
          // Cropped, but not so far that only the wheels survive.
          'h-36 w-36 translate-x-2 sm:h-44 sm:w-44 sm:translate-x-3',
          TONES[tone]
        )}
        strokeWidth={1.2}
      />
    </motion.div>
  );
}
