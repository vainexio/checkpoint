/**
 * Which trips are worth showing someone right now.
 *
 * Once schedules generate a week ahead, "every trip that is not finished" stops
 * being a useful list: a board at PITX would open on Thursday's 06:00 before it
 * reached the bus boarding now. And a scheduled trip nobody ran would sit there
 * as "not yet departed" forever. So every live view reads through one window.
 */

const HOUR_MS = 60 * 60 * 1000;

/** A board shows departures up to this far ahead — the rest of a working day. */
export const UPCOMING_HOURS = 12;

/**
 * A trip that has still not left this long after its scheduled time did not
 * run. It stops being advertised; the operator still sees it in the trip list.
 */
export const NOT_RUN_AFTER_HOURS = 3;

/**
 * Past this, a trip that left but never reported arriving is abandoned rather
 * than in progress. No route here takes anything like a day to drive.
 */
export const ABANDONED_AFTER_HOURS = 24;

/**
 * A MongoDB filter for trips inside the live window. Spread it into a query.
 *
 * `upcomingHours: null` removes the forward limit, for a conductor's own list
 * where the whole roster ahead is the point.
 */
export function liveWindow(now = new Date(), { upcomingHours = UPCOMING_HOURS } = {}) {
  const t = now.getTime();
  const departure = { $gte: new Date(t - ABANDONED_AFTER_HOURS * HOUR_MS) };
  if (upcomingHours !== null) departure.$lte = new Date(t + upcomingHours * HOUR_MS);

  return {
    scheduledDeparture: departure,
    $or: [
      { actualDeparture: { $ne: null } },
      { scheduledDeparture: { $gte: new Date(t - NOT_RUN_AFTER_HOURS * HOUR_MS) } },
    ],
  };
}

/** The same "did not run" rule, for a trip already loaded. */
export const didNotRun = (trip, now = new Date()) =>
  trip.status === 'scheduled' &&
  !trip.actualDeparture &&
  now.getTime() - new Date(trip.scheduledDeparture).getTime() > NOT_RUN_AFTER_HOURS * HOUR_MS;
