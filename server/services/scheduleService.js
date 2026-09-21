import { CheckpointLog, Route, Schedule, Trip } from '../models/index.js';
import { buildPlan } from './etaEngine.js';

/**
 * Recurring schedules: an operator describes a departure once — route, bus,
 * conductor, time, days — and trips are generated from it for a rolling window.
 *
 * Generation is idempotent by construction. Each trip is keyed by its schedule
 * and service day under a unique index, so running it twice, on a timer and on
 * an edit at the same moment, or from two server processes against one
 * database, can only ever produce one trip per day.
 *
 * Everything that depends on the calendar is a pure function of `now`, so it is
 * tested without a clock or a database.
 */

/** How far ahead trips exist. A week lets a conductor see their roster. */
export const GENERATION_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Manila does not observe daylight saving, so its offset is a constant. A
 * schedule's 06:00 is Manila's 06:00 whatever the server's own time zone is.
 */
const MANILA_OFFSET_MINUTES = 8 * 60;

/** The Manila calendar day an instant falls on, as YYYY-MM-DD. */
export const manilaDate = (instant = new Date()) =>
  new Date(new Date(instant).getTime() + MANILA_OFFSET_MINUTES * 60000)
    .toISOString()
    .slice(0, 10);

export const addDays = (ymd, n) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** 0 = Sunday … 6 = Saturday. A calendar date has the same weekday everywhere. */
export const weekdayOf = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();

/** The instant a Manila wall-clock time on a Manila day happens. */
export function departureOn(ymd, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + (h * 60 + m - MANILA_OFFSET_MINUTES) * 60000);
}

/**
 * The days a schedule runs on inside the window, and when it leaves on each.
 *
 * A departure already in the past is left out. Nobody can catch it, and a trip
 * created after the fact would sit on every list as "not yet departed" for a
 * bus that never ran — so a schedule made at 10:00 starts with tomorrow's
 * 06:00, not today's.
 */
export function plannedDepartures(schedule, { now = new Date(), days = GENERATION_DAYS } = {}) {
  const today = manilaDate(now);
  const skip = new Set(schedule.skipDates ?? []);
  const out = [];

  for (let i = 0; i < days; i += 1) {
    const date = addDays(today, i);
    if (date < schedule.startDate) continue;
    if (schedule.endDate && date > schedule.endDate) break;
    if (!schedule.daysOfWeek.includes(weekdayOf(date))) continue;
    if (skip.has(date)) continue;

    const departure = departureOn(date, schedule.departureTime);
    if (departure <= now) continue;

    out.push({ serviceDate: date, departure });
  }

  return out;
}

const isDuplicateOnly = (err) =>
  err?.code === 11000 ||
  (Array.isArray(err?.writeErrors) && err.writeErrors.every((e) => (e.err?.code ?? e.code) === 11000));

/**
 * Create every trip the active schedules call for in the window, and nothing
 * else. Returns how many were actually new.
 *
 * Each trip gets its own frozen plan from the route as it stands today, exactly
 * like a hand-entered trip, so a route edited next week changes next week's
 * trips and not the ones already on the road.
 */
export async function generateScheduledTrips({
  now = new Date(),
  days = GENERATION_DAYS,
  scheduleIds = null,
} = {}) {
  const filter = { isActive: true };
  if (scheduleIds) filter._id = { $in: scheduleIds };

  const schedules = await Schedule.find(filter).lean();
  if (!schedules.length) return { created: 0, schedules: 0 };

  // A retired route generates nothing. Putting a trip on a route the operator
  // switched off would advertise a bus that is not coming.
  const routes = await Route.find({
    _id: { $in: [...new Set(schedules.map((s) => String(s.route)))] },
    isActive: true,
  }).populate('checkpoints.checkpoint', 'name type');
  const routeById = new Map(routes.map((r) => [String(r._id), r]));

  const wanted = [];
  for (const schedule of schedules) {
    const route = routeById.get(String(schedule.route));
    if (!route) continue;
    for (const { serviceDate, departure } of plannedDepartures(schedule, { now, days })) {
      wanted.push({ schedule, route, serviceDate, departure });
    }
  }
  if (!wanted.length) return { created: 0, schedules: schedules.length };

  // Skip what already exists — including cancelled trips, which is how a
  // cancelled day stays cancelled.
  const existing = await Trip.find({
    schedule: { $in: schedules.map((s) => s._id) },
    serviceDate: { $in: [...new Set(wanted.map((w) => w.serviceDate))] },
  })
    .select('schedule serviceDate')
    .lean();
  const have = new Set(existing.map((t) => `${t.schedule}:${t.serviceDate}`));

  const docs = wanted
    .filter((w) => !have.has(`${w.schedule._id}:${w.serviceDate}`))
    .map((w) => ({
      route: w.route._id,
      bus: w.schedule.bus,
      conductor: w.schedule.conductor,
      plan: buildPlan(w.route, { departure: w.departure }),
      scheduledDeparture: w.departure,
      status: 'scheduled',
      schedule: w.schedule._id,
      serviceDate: w.serviceDate,
    }));
  if (!docs.length) return { created: 0, schedules: schedules.length };

  // The check above is an optimisation, not the guarantee. Another process can
  // insert the same day between that read and this write; the unique index
  // rejects it, and a rejection for that reason is the system working.
  try {
    const inserted = await Trip.insertMany(docs, { ordered: false });
    return { created: inserted.length, schedules: schedules.length };
  } catch (err) {
    if (!isDuplicateOnly(err)) throw err;
    return {
      created: err.insertedDocs?.length ?? err.result?.insertedCount ?? 0,
      schedules: schedules.length,
    };
  }
}

/**
 * Remove a schedule's future trips that nobody has touched, so they can be
 * generated again from the pattern as it now stands.
 *
 * Only trips that are purely the pattern's output go: not departed, not
 * cancelled, not edited by hand, and with nothing logged against them. A trip
 * an operator adjusted is theirs now, and a trip with a single tap on it is a
 * record.
 */
export async function removeUntouchedFutureTrips(scheduleId, now = new Date()) {
  const candidates = await Trip.find({
    schedule: scheduleId,
    scheduleOverride: false,
    status: 'scheduled',
    actualDeparture: null,
    scheduledDeparture: { $gt: now },
  })
    .select('_id')
    .lean();
  if (!candidates.length) return 0;

  const ids = candidates.map((t) => t._id);
  const logged = new Set(
    (await CheckpointLog.distinct('trip', { trip: { $in: ids } })).map(String)
  );
  const removable = ids.filter((id) => !logged.has(String(id)));

  await Trip.deleteMany({ _id: { $in: removable } });
  return removable.length;
}

/** Re-apply one schedule after it changed: clear what it owns, then regenerate. */
export async function reapplySchedule(scheduleId, now = new Date()) {
  const removed = await removeUntouchedFutureTrips(scheduleId, now);
  const { created } = await generateScheduledTrips({ now, scheduleIds: [scheduleId] });
  return { removed, created };
}

/* ------------------------------------------------------------ background -- */

const GENERATION_INTERVAL_MS = 60 * 60 * 1000;
let timer = null;

async function generateAndLog() {
  try {
    const { created } = await generateScheduledTrips();
    if (created) console.log(`[schedules] generated ${created} trip${created === 1 ? '' : 's'}`);
  } catch (err) {
    console.warn('[schedules] generation failed:', err.message);
  }
}

/**
 * Keep the window topped up. Runs once at start-up, then hourly, so the far
 * edge of the window moves forward a day at a time without anyone pressing
 * anything. Costs a couple of database reads when there is nothing to do.
 */
export function startScheduleGenerator(intervalMs = GENERATION_INTERVAL_MS) {
  generateAndLog();
  timer = setInterval(generateAndLog, intervalMs);
  timer.unref?.();
  return timer;
}

export function stopScheduleGenerator() {
  if (timer) clearInterval(timer);
  timer = null;
}
