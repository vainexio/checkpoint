import { useState } from 'react';
import { AlertCircle, CalendarSync, Pause, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { useList } from '@/hooks/useList.js';
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  updateSchedule,
} from '@/api/adminApi.js';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { cn } from '@/lib/utils.ts';
import { formatDay, formatTime } from '@/utils/time.js';

/**
 * Recurring departures: the timetable an operator actually has, entered once.
 *
 * Each schedule generates a week of ordinary trips, so everything downstream —
 * the conductor's list, the boards, the dashboard — works on them unchanged.
 * Editing a schedule regenerates the days nobody has touched; a day changed by
 * hand in the trip list below keeps its change.
 */

// Monday first, because that is how a working week is read. Values are
// Date#getDay numbers, which is what the server stores.
const WEEK = [
  { day: 1, short: 'Mon' },
  { day: 2, short: 'Tue' },
  { day: 3, short: 'Wed' },
  { day: 4, short: 'Thu' },
  { day: 5, short: 'Fri' },
  { day: 6, short: 'Sat' },
  { day: 0, short: 'Sun' },
];
const PRESETS = [
  { label: 'Daily', days: [0, 1, 2, 3, 4, 5, 6] },
  { label: 'Weekdays', days: [1, 2, 3, 4, 5] },
  { label: 'Weekends', days: [0, 6] },
];

const sameDays = (a, b) => a.length === b.length && a.every((d) => b.includes(d));

/** "Daily", "Weekdays", or the days themselves — whichever a person would say. */
export function describeDays(days = []) {
  const preset = PRESETS.find((p) => sameDays(p.days, days));
  if (preset) return preset.label;
  return WEEK.filter((w) => days.includes(w.day))
    .map((w) => w.short)
    .join(', ');
}

/** "06:00" as the rest of the app writes a time: "06:00 AM". */
export function formatClock(hhmm) {
  if (!hhmm) return '—';
  const [h, m] = hhmm.split(':').map(Number);
  return formatTime(new Date(Date.UTC(2026, 0, 1, h - 8, m)));
}

const EMPTY = {
  routeId: '',
  busId: '',
  conductorId: '',
  departureTime: '06:00',
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  startDate: '',
  endDate: '',
};

export function ScheduleManager({ routes, buses, conductors, onTripsChanged }) {
  const schedules = useList(() => listSchedules().then((r) => r.schedules));
  // null when closed, 'new' for a new schedule, or the id being edited.
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const open = (schedule = null) => {
    setError(null);
    setNotice(null);
    if (!schedule) {
      setForm(EMPTY);
      setEditing('new');
      return;
    }
    setForm({
      routeId: schedule.route?.id ?? '',
      busId: schedule.bus?.id ?? '',
      conductorId: schedule.conductor?.id ?? '',
      departureTime: schedule.departureTime,
      daysOfWeek: schedule.daysOfWeek,
      startDate: schedule.startDate ?? '',
      endDate: schedule.endDate ?? '',
    });
    setEditing(schedule.id);
  };

  const refresh = async () => {
    await schedules.reload();
    await onTripsChanged?.();
  };

  const run = async (fn, describe) => {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      setNotice(describe?.(result) ?? null);
      await refresh();
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.daysOfWeek.length) {
      setError(new Error('Choose at least one day of the week.'));
      return;
    }
    const body = { ...form, startDate: form.startDate || undefined, endDate: form.endDate || null };
    const ok = await run(
      () => (editing === 'new' ? createSchedule(body) : updateSchedule(editing, body)),
      (r) =>
        editing === 'new'
          ? `Schedule added — ${plural(r.created, 'trip')} generated for the week ahead.`
          : `Schedule updated — ${plural(r.created, 'trip')} regenerated. Days changed by hand were left as they are.`
    );
    if (ok) setEditing(null);
  };

  const toggleDay = (day) =>
    setForm((f) => ({
      ...f,
      daysOfWeek: f.daysOfWeek.includes(day)
        ? f.daysOfWeek.filter((d) => d !== day)
        : [...f.daysOfWeek, day],
    }));

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <CalendarSync className="h-4 w-4 text-primary-strong" />
            Recurring schedules
          </CardTitle>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Enter a departure once and its trips are created for the next 7 days, topped up
            every hour.
          </p>
        </div>
        {editing === null && (
          <Button size="sm" onClick={() => open()}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add schedule
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {(error || schedules.error) && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{(error ?? schedules.error).message}</AlertDescription>
          </Alert>
        )}
        {notice && !error && (
          <div className="rounded-lg border border-success/40 tint-success px-3 py-2 text-[13px] font-medium">
            {notice}
          </div>
        )}

        {editing !== null && (
          <form onSubmit={save} className="space-y-4 rounded-xl border border-border bg-muted/40 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">
                {editing === 'new' ? 'New schedule' : 'Edit schedule'}
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEditing(null)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Picker
                label="Route"
                value={form.routeId}
                onChange={(v) => setForm({ ...form, routeId: v })}
                options={routes.map((r) => ({ value: r._id, label: r.name }))}
              />
              <Picker
                label="Bus"
                value={form.busId}
                onChange={(v) => setForm({ ...form, busId: v })}
                options={buses.map((b) => ({ value: b._id, label: b.plateNumber }))}
              />
              <Picker
                label="Conductor"
                value={form.conductorId}
                onChange={(v) => setForm({ ...form, conductorId: v })}
                options={conductors.map((c) => ({ value: c._id, label: c.name }))}
              />
              <div className="space-y-2">
                <Label htmlFor="schedule-time">Departs (Manila time)</Label>
                <Input
                  id="schedule-time"
                  type="time"
                  value={form.departureTime}
                  onChange={(e) => setForm({ ...form, departureTime: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Runs on</Label>
              <div className="flex flex-wrap items-center gap-1.5">
                {WEEK.map(({ day, short }) => {
                  const on = form.daysOfWeek.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleDay(day)}
                      className={cn(
                        'h-9 w-12 rounded-lg border text-[13px] font-semibold transition-colors',
                        on
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {short}
                    </button>
                  );
                })}
                <span className="mx-1 h-5 w-px bg-border" />
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setForm({ ...form, daysOfWeek: p.days })}
                    className="rounded-lg px-2 py-1.5 text-[12px] font-semibold text-primary-strong hover:underline"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="schedule-start">Starts</Label>
                <Input
                  id="schedule-start"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                />
                <p className="text-[12px] text-muted-foreground">Blank means today.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="schedule-end">Ends</Label>
                <Input
                  id="schedule-end"
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                />
                <p className="text-[12px] text-muted-foreground">Blank means until stopped.</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : editing === 'new' ? 'Add schedule' : 'Save changes'}
              </Button>
              {editing !== 'new' && (
                <span className="text-[12px] text-muted-foreground">
                  Future trips nobody has touched are regenerated. Trips already departed, cancelled
                  or changed by hand stay as they are.
                </span>
              )}
            </div>
          </form>
        )}

        {schedules.loading && !schedules.items.length && (
          <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
        )}
        {!schedules.loading && schedules.items.length === 0 && editing === null && (
          <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
            No recurring schedules yet. Every trip below was entered by hand.
          </div>
        )}

        {schedules.items.length > 0 && (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {schedules.items.map((s) => (
              <li
                key={s.id}
                className={cn(
                  'flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between',
                  !s.isActive && 'bg-muted/50'
                )}
              >
                <div className="flex min-w-0 items-start gap-4">
                  <div className="w-[84px] shrink-0 font-mono text-[17px] font-bold tabular">
                    {formatClock(s.departureTime)}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold">
                      {s.route?.name ?? 'Route removed'}
                      {!s.isActive && (
                        <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                          Paused
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[13px] text-muted-foreground">
                      {describeDays(s.daysOfWeek)} ·{' '}
                      <span className="font-mono font-semibold text-foreground">
                        {s.bus?.plateNumber ?? '—'}
                      </span>{' '}
                      · {s.conductor?.name ?? 'No conductor'}
                    </div>
                    <div className="mt-0.5 text-[12px] text-muted-foreground">
                      {s.isActive
                        ? s.nextDeparture
                          ? `Next ${formatDay(s.nextDeparture)}, ${formatTime(s.nextDeparture)} · ${plural(s.upcomingTrips, 'trip')} ahead`
                          : 'Nothing in the next 7 days'
                        : 'Generates nothing until resumed'}
                      {s.endDate && ` · ends ${s.endDate}`}
                      {s.skipDates?.length > 0 && ` · ${plural(s.skipDates.length, 'day')} removed`}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => open(s)} disabled={busy}>
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => updateSchedule(s.id, { isActive: !s.isActive }),
                        (r) =>
                          s.isActive
                            ? `Paused — ${plural(r.removed, 'upcoming trip')} taken off the timetable.`
                            : `Resumed — ${plural(r.created, 'trip')} generated.`
                      )
                    }
                  >
                    {s.isActive ? (
                      <Pause className="mr-1.5 h-3.5 w-3.5" />
                    ) : (
                      <Play className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {s.isActive ? 'Pause' : 'Resume'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label="Delete schedule"
                    className="text-destructive-strong hover:bg-destructive/10 hover:text-destructive-strong"
                    onClick={() => {
                      if (
                        !window.confirm(
                          'Delete this schedule? Its upcoming trips are removed; trips that already ran, or that were changed by hand, are kept.'
                        )
                      ) {
                        return;
                      }
                      run(
                        () => deleteSchedule(s.id),
                        (r) => `Schedule deleted — ${plural(r.removed, 'upcoming trip')} removed.`
                      );
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const plural = (n, word) => `${n ?? 0} ${word}${n === 1 ? '' : 's'}`;

export function Picker({ label, value, onChange, options, placeholder = 'Select…' }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
