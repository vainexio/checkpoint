import { bandAt, OFF_PEAK } from './etaEngine.js';

/**
 * What the trips that already ran say a leg really takes.
 *
 * Every completed trip is a measurement nobody had to ask for: the conductor
 * confirmed a stop, then the next one, and the gap between those two taps is
 * how long that leg took that day, under that day's traffic, with that day's
 * dwell. Enough of them and the road tells you its own baseline — which is the
 * one number in this system that decides whether every ETA on a route is
 * right or quietly wrong.
 *
 * Three decisions keep this honest:
 *
 *   - **It suggests, never applies.** An operator knows things the data does
 *     not: a market day, a closed lane, a new terminal entrance. The numbers
 *     arrive as "twelve trips say 44 minutes; you have 38", and a person
 *     decides.
 *   - **The median, not the mean.** One bus that broke down for an hour would
 *     drag an average into nonsense, and that bus is exactly the kind of thing
 *     that happens on a provincial route.
 *   - **Per band.** A leg measured in the evening rush belongs to the evening
 *     rush figure, not to the all-day one, or recalibration would slowly push
 *     every baseline towards whatever hour the route happens to run most.
 *
 * It measures exactly what the engine measures: confirmation to confirmation.
 * That is the same quantity the baseline is compared against when variance is
 * computed, dwell included, so a suggestion accepted here makes the variance it
 * was derived from go to zero.
 */

/** Below this, a difference is noise and not worth an operator's attention. */
export const MIN_DELTA_MINUTES = 2;

/** Fewer samples than this cannot outvote what the operator already set. */
export const MIN_SAMPLES = 5;

/** How far back to look. Older trips describe a road that may have changed. */
export const DEFAULT_WINDOW_DAYS = 30;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
};

/**
 * Every leg one finished trip actually drove, with the band it drove it in.
 *
 * A leg only counts when both ends were genuinely confirmed. A checkpoint the
 * conductor skipped leaves no observation, and inventing one by spreading the
 * gap over two legs would be making data up.
 */
export function legSamples(trip) {
  const stops = trip.computedETAs ?? [];
  const out = [];

  for (let i = 1; i < stops.length; i += 1) {
    const from = stops[i - 1];
    const to = stops[i];
    if (from.progress !== 'passed' || to.progress !== 'passed') continue;
    if (!from.actualArrival || !to.actualArrival) continue;

    const minutes = (new Date(to.actualArrival) - new Date(from.actualArrival)) / 60000;
    if (!Number.isFinite(minutes) || minutes <= 0) continue;

    out.push({
      from: String(from.checkpoint),
      to: String(to.checkpoint),
      // The band the bus was actually driving in, taken from when it started
      // the leg rather than when the trip left.
      band: bandAt(from.actualArrival),
      minutes,
    });
  }

  return out;
}

/**
 * Group what the trips drove against what the route says, leg by leg and band
 * by band. Pure: hand it trips and the route's current figures.
 *
 * `route.checkpoints` is the ordered list with the numbers an operator set, in
 * the same shape the admin API returns.
 */
export function calibrate(route, trips, { minSamples = MIN_SAMPLES } = {}) {
  const samples = new Map();
  for (const trip of trips) {
    for (const sample of legSamples(trip)) {
      const key = `${sample.from}->${sample.to}:${sample.band}`;
      if (!samples.has(key)) samples.set(key, []);
      samples.get(key).push(sample.minutes);
    }
  }

  const entries = route.checkpoints ?? [];
  const legs = [];

  for (let i = 1; i < entries.length; i += 1) {
    const from = entries[i - 1];
    const to = entries[i];
    const fromId = String(from.checkpoint?._id ?? from.checkpoint);
    const toId = String(to.checkpoint?._id ?? to.checkpoint);

    const bands = [];
    for (const [band, field] of [
      [OFF_PEAK, 'baselineMinutesFromPrevious'],
      ['amPeak', 'amPeakMinutes'],
      ['pmPeak', 'pmPeakMinutes'],
    ]) {
      const observed = samples.get(`${fromId}->${toId}:${band}`) ?? [];
      // A leg with no rush-hour figure of its own is judged against the one it
      // actually uses at that hour, which is the all-day number.
      const current = to[field] ?? (band === OFF_PEAK ? 0 : to.baselineMinutesFromPrevious ?? 0);

      // A trip that took four times its baseline was not driving this leg —
      // it broke down, or a tap sat in a queue for a day. The median would
      // survive a few of those; dropping them keeps the spread meaningful too.
      const plausible = observed.filter((m) => !current || m <= current * 4);
      if (!plausible.length) continue;

      const measured = Math.round(median(plausible));
      bands.push({
        band,
        field,
        samples: plausible.length,
        discarded: observed.length - plausible.length,
        measuredMinutes: measured,
        currentMinutes: current,
        deltaMinutes: measured - current,
        spread: {
          lowMinutes: Math.round(percentile(plausible, 0.25)),
          highMinutes: Math.round(percentile(plausible, 0.75)),
        },
        // What an operator should be shown as worth acting on: enough trips to
        // mean something, and a gap big enough to matter.
        worthChanging:
          plausible.length >= minSamples && Math.abs(measured - current) >= MIN_DELTA_MINUTES,
      });
    }

    if (bands.length) {
      legs.push({
        fromCheckpointId: fromId,
        toCheckpointId: toId,
        fromName: from.checkpoint?.name ?? null,
        toName: to.checkpoint?.name ?? null,
        bands,
      });
    }
  }

  return {
    minSamples,
    legs,
    // The headline: how many legs are worth a second look at all.
    suggestions: legs.reduce((n, leg) => n + leg.bands.filter((b) => b.worthChanging).length, 0),
  };
}
