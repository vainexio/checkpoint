import mongoose from 'mongoose';

/**
 * A departure that repeats: "PITX – Lipa, 06:00, every weekday, SBL 3561 with
 * Dennis". Trips are generated from it for a rolling window ahead, so an
 * operator describes the timetable once instead of typing every trip by hand.
 *
 * A schedule is a pattern, never a trip. Each generated trip is an ordinary
 * trip with its own frozen plan; it only remembers which schedule and which
 * service day it came from. That is what lets one day be changed or cancelled
 * without touching the pattern, and the pattern be changed without rewriting a
 * trip somebody already adjusted by hand.
 */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const scheduleSchema = new mongoose.Schema(
  {
    route: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', required: true },
    bus: { type: mongoose.Schema.Types.ObjectId, ref: 'Bus', required: true },
    conductor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // Manila wall-clock time. Stored as the time an operator reads off a
    // timetable, not as an instant, because 06:00 is 06:00 every day.
    departureTime: {
      type: String,
      required: true,
      match: [HHMM, 'Departure time must be HH:MM, 24-hour.'],
    },

    // 0 = Sunday … 6 = Saturday, the way Date#getDay counts.
    daysOfWeek: {
      type: [Number],
      validate: {
        validator: (v) =>
          Array.isArray(v) &&
          v.length > 0 &&
          v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) &&
          new Set(v).size === v.length,
        message: 'Choose at least one day of the week.',
      },
    },

    // Service days, in Manila, as YYYY-MM-DD. The window the pattern runs in.
    startDate: { type: String, required: true, match: YMD },
    endDate: { type: String, default: null, match: YMD },

    /**
     * Days taken out of the pattern by hand — a trip deleted outright, say.
     *
     * A cancelled trip needs no entry here: it still exists, and its existence
     * is what stops the day being generated again. A deleted one leaves no
     * trace, so without this the next generation run would quietly put back
     * the very trip an operator just removed.
     */
    skipDates: { type: [String], default: [] },

    // Paused schedules generate nothing, and keep their pattern for later.
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

scheduleSchema.pre('validate', function normalise(next) {
  if (Array.isArray(this.daysOfWeek)) {
    this.daysOfWeek = [...new Set(this.daysOfWeek.map(Number))].sort((a, b) => a - b);
  }
  if (this.endDate && this.startDate && this.endDate < this.startDate) {
    this.invalidate('endDate', 'The end date is before the start date.');
  }
  next();
});

export default mongoose.model('Schedule', scheduleSchema);
