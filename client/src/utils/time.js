/**
 * Everything is stored and transmitted in UTC and displayed in Asia/Manila —
 * explicitly, not by trusting the viewer's device clock. A terminal display in
 * Cubao and a phone set to the wrong timezone must show the same arrival time.
 */
const MANILA = 'Asia/Manila';

const timeFmt = new Intl.DateTimeFormat('en-PH', {
  timeZone: MANILA,
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

const dayFmt = new Intl.DateTimeFormat('en-PH', {
  timeZone: MANILA,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

const dateTimeFmt = new Intl.DateTimeFormat('en-PH', {
  timeZone: MANILA,
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

const asDate = (value) => (value instanceof Date ? value : value ? new Date(value) : null);

export const formatTime = (value) => {
  const d = asDate(value);
  return d && !Number.isNaN(d.getTime()) ? timeFmt.format(d) : '—';
};

export const formatDay = (value) => {
  const d = asDate(value);
  return d && !Number.isNaN(d.getTime()) ? dayFmt.format(d) : '—';
};

export const formatDateTime = (value) => {
  const d = asDate(value);
  return d && !Number.isNaN(d.getTime()) ? dateTimeFmt.format(d) : '—';
};

/** "in 42 min" / "12 min ago" — the reading a passenger actually wants. */
export function relativeMinutes(value, now = new Date()) {
  const d = asDate(value);
  if (!d || Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - now.getTime()) / 60000);
}

export function formatCountdown(value, now = new Date()) {
  const mins = relativeMinutes(value, now);
  if (mins === null) return '';
  if (mins <= -60 || mins >= 60) {
    const h = Math.floor(Math.abs(mins) / 60);
    const m = Math.abs(mins) % 60;
    const span = m ? `${h}h ${m}m` : `${h}h`;
    return mins < 0 ? `${span} ago` : `in ${span}`;
  }
  if (mins < -1) return `${Math.abs(mins)} min ago`;
  if (mins <= 1) return 'now';
  return `in ${mins} min`;
}

/**
 * A bare span — "12 min", "1h 20m" — with no "in" and no "ago".
 *
 * The prefix belongs in the label above it ("Arrives in"), not in the number
 * itself: a countdown set large enough to read across a terminal hall should
 * spend its width on the figure, not on a preposition.
 */
export function formatDuration(minutes) {
  const m = Math.abs(Math.round(minutes ?? 0));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

export function formatElapsed(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** "+12 min" / "8 min early" / "on baseline" — never a bare signed integer. */
export function formatVariance(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes === 0) return 'on schedule';
  if (minutes > 0) return `${minutes} min late`;
  return `${Math.abs(minutes)} min early`;
}

/** Value for a datetime-local input, in Manila terms rather than the browser's. */
export function toManilaInputValue(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MANILA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/**
 * Read a datetime-local value as Manila wall-clock time.
 *
 * The input has no timezone, and the browser would read it as local. On an
 * operator's laptop set to another zone that would schedule the trip hours off,
 * so the offset is applied explicitly. PH has no DST, hence the fixed +08:00.
 */
export const fromManilaInputValue = (value) => (value ? new Date(`${value}:00+08:00`) : null);
