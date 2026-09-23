import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CalendarClock, ClipboardPen, Pencil, Repeat, Trash2 } from 'lucide-react';
import { useList } from '@/hooks/useList.js';
import {
  createTrip,
  deleteTrip,
  listBuses,
  listConductors,
  listRoutes,
  listTrips,
  updateTrip,
} from '@/api/adminApi.js';
import { StatusBadge } from '@/components/StatusBadge.jsx';
import { SegmentedTabs } from '@/components/SegmentedTabs.jsx';
import { PageHeader } from '@/components/layout/AppLayout.jsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table.tsx';
import { cn } from '@/lib/utils.ts';
import {
  formatDateTime,
  formatElapsed,
  formatVariance,
  fromManilaInputValue,
  toManilaInputValue,
} from '@/utils/time.js';
import { Picker, ScheduleManager } from './ScheduleManager.jsx';

/**
 * Which slice of trips the list shows. Once schedules generate a week ahead a
 * single list opens on next week and buries the buses running now, so it is
 * split the way a dispatcher thinks about it.
 */
const VIEWS = [
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
];

export default function AdminTripsPage() {
  const routes = useList(listRoutes);
  const buses = useList(listBuses);
  const conductors = useList(listConductors);

  const [view, setView] = useState('today');
  const trips = useList(() => listTrips(`?view=${view}&limit=150`).then((r) => r.trips), [view]);

  const [form, setForm] = useState({
    routeId: '',
    busId: '',
    conductorId: '',
    scheduledDeparture: toManilaInputValue(new Date(Date.now() + 30 * 60000)),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // The trip whose bus, conductor or time is being changed, if any.
  const [editingId, setEditingId] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createTrip({
        ...form,
        // The operator typed a Manila wall-clock time; send the real instant.
        scheduledDeparture: fromManilaInputValue(form.scheduledDeparture).toISOString(),
      });
      await trips.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn) => {
    setError(null);
    try {
      await fn();
      await trips.reload();
      return true;
    } catch (err) {
      setError(err);
      return false;
    }
  };

  return (
    <>
      <PageHeader
        bare
        icon={CalendarClock}
        title="Trips"
        description="Recurring schedules generate the week's trips; one-off trips are added by hand. Either way, a trip copies its route's checkpoints and times when it is created, so editing the route later never changes a trip already made."
      />

      {(error || trips.error) && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{(error ?? trips.error).message}</AlertDescription>
        </Alert>
      )}

      <ScheduleManager
        routes={routes.items}
        buses={buses.items}
        conductors={conductors.items}
        onTripsChanged={trips.reload}
      />

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Add a one-off trip</CardTitle>
          <p className="text-[13px] text-muted-foreground">
            For a departure outside the timetable — an extra bus on a holiday, a replacement run.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Picker
                label="Route"
                value={form.routeId}
                onChange={(v) => setForm({ ...form, routeId: v })}
                options={routes.items.map((r) => ({ value: r._id, label: r.name }))}
              />
              <Picker
                label="Bus"
                value={form.busId}
                onChange={(v) => setForm({ ...form, busId: v })}
                options={buses.items.map((b) => ({ value: b._id, label: b.plateNumber }))}
              />
              <Picker
                label="Conductor"
                value={form.conductorId}
                onChange={(v) => setForm({ ...form, conductorId: v })}
                options={conductors.items.map((c) => ({ value: c._id, label: c.name }))}
              />
              <div className="space-y-2">
                <Label htmlFor="departure">Departure (Manila time)</Label>
                <Input
                  id="departure"
                  type="datetime-local"
                  value={form.scheduledDeparture}
                  onChange={(e) => setForm({ ...form, scheduledDeparture: e.target.value })}
                  required
                />
              </div>
            </div>

            <Button type="submit" disabled={busy}>
              {busy ? 'Scheduling…' : 'Add trip'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>
            Trips <span className="ml-1 font-mono text-xs text-muted-foreground">{trips.items.length}</span>
          </CardTitle>
          <SegmentedTabs options={VIEWS} value={view} onChange={setView} />
        </CardHeader>
        <CardContent>
          {trips.loading && !trips.items.length && (
            <div className="py-10 text-center text-muted-foreground">Loading…</div>
          )}
          {!trips.loading && trips.items.length === 0 && (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
              {view === 'today'
                ? 'No trips today.'
                : view === 'upcoming'
                  ? 'Nothing scheduled after today. Add a recurring schedule to fill the week.'
                  : 'No past trips.'}
            </div>
          )}

          {trips.items.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Route</TableHead>
                    <TableHead>Departure</TableHead>
                    <TableHead>Bus</TableHead>
                    <TableHead>Conductor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last confirmed</TableHead>
                    <TableHead>Running</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trips.items.map((trip) => {
                    const canEdit = trip.status === 'scheduled' && !trip.actualDeparture;
                    return (
                      <Fragment key={trip.id}>
                        <TableRow className={cn(trip.isStale && 'bg-muted/60')}>
                          <TableCell>
                            <Link
                              to={`/admin/trips/${trip.id}`}
                              className="font-semibold hover:text-primary-strong hover:underline"
                            >
                              {trip.route.name}
                            </Link>
                            <SourceTag source={trip.source} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {formatDateTime(trip.scheduledDeparture)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap font-mono text-xs font-semibold">
                            {trip.bus?.plateNumber ?? '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {trip.conductor?.name ?? (
                              <span className="text-muted-foreground">Unassigned</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {trip.didNotRun ? (
                              <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                                Did not run
                              </span>
                            ) : trip.abandoned ? (
                              // Departed, then silence. Nothing is claimed about
                              // where it went, only that it stopped reporting.
                              <span
                                className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground"
                                title="No report for hours past its expected arrival, so it was closed. A later tap reopens it."
                              >
                                Stopped reporting
                              </span>
                            ) : (
                              <StatusBadge
                                status={trip.status}
                                isStale={trip.isStale}
                                varianceMinutes={trip.varianceMinutes}
                                conditionsAllowanceMinutes={trip.conditionsAllowanceMinutes}
                              />
                            )}
                          </TableCell>
                          {/* Where it actually is, which the dashboard shows and
                              this list did not — the same question, asked from
                              a different page. */}
                          <TableCell className="whitespace-nowrap text-xs">
                            {trip.lastConfirmedCheckpoint ? (
                              <>
                                <div className="font-medium">{trip.lastConfirmedCheckpoint.name}</div>
                                {trip.minutesSinceLastConfirm != null && (
                                  <div className="text-muted-foreground">
                                    {formatElapsed(trip.minutesSinceLastConfirm)} ago
                                  </div>
                                )}
                              </>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {trip.actualDeparture ? formatVariance(trip.varianceMinutes) : '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right">
                            {canEdit && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="mr-2"
                                onClick={() => setEditingId(editingId === trip.id ? null : trip.id)}
                              >
                                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                                Edit
                              </Button>
                            )}
                            {canEdit && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="mr-2"
                                onClick={() => act(() => updateTrip(trip.id, { status: 'cancelled' }))}
                              >
                                Cancel
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label="Delete trip"
                              className="text-destructive-strong hover:bg-destructive/10 hover:text-destructive-strong"
                              onClick={() => {
                                const note =
                                  trip.source?.kind === 'schedule'
                                    ? ' Its schedule will not recreate it.'
                                    : '';
                                if (window.confirm(`Delete this trip and its records?${note}`)) {
                                  act(() => deleteTrip(trip.id));
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>

                        {editingId === trip.id && (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={8} className="bg-muted/40">
                              <TripEditor
                                trip={trip}
                                buses={buses.items}
                                conductors={conductors.items}
                                onCancel={() => setEditingId(null)}
                                onSave={async (body) => {
                                  if (await act(() => updateTrip(trip.id, body))) setEditingId(null);
                                }}
                              />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/** Where a trip came from, in a word — and whether one day of a pattern was changed. */
function SourceTag({ source }) {
  if (!source) return null;
  if (source.kind === 'manual') {
    return (
      <span className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <ClipboardPen className="h-3 w-3" /> One-off
      </span>
    );
  }
  return (
    <span className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-primary-strong">
      <Repeat className="h-3 w-3" /> Recurring
      {source.overridden && <span className="text-muted-foreground"> · changed for this day</span>}
    </span>
  );
}

/**
 * Change one trip's bus, conductor or time. On a trip from a schedule this
 * changes that day only; the schedule itself is edited above.
 */
function TripEditor({ trip, buses, conductors, onCancel, onSave }) {
  const [busId, setBusId] = useState(buses.find((b) => b.plateNumber === trip.bus?.plateNumber)?._id ?? '');
  const [conductorId, setConductorId] = useState(trip.conductor?.id ?? '');
  const [departure, setDeparture] = useState(toManilaInputValue(new Date(trip.scheduledDeparture)));
  const [saving, setSaving] = useState(false);

  return (
    <form
      className="flex flex-col gap-4 py-2 lg:flex-row lg:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        await onSave({
          busId,
          conductorId,
          scheduledDeparture: fromManilaInputValue(departure).toISOString(),
        });
        setSaving(false);
      }}
    >
      <div className="grid flex-1 gap-4 sm:grid-cols-3">
        <Picker
          label="Bus"
          value={busId}
          onChange={setBusId}
          options={buses.map((b) => ({ value: b._id, label: b.plateNumber }))}
        />
        <Picker
          label="Conductor"
          value={conductorId}
          onChange={setConductorId}
          options={conductors.map((c) => ({ value: c._id, label: c.name }))}
        />
        <div className="space-y-2">
          <Label htmlFor={`dep-${trip.id}`}>Departure (Manila time)</Label>
          <Input
            id={`dep-${trip.id}`}
            type="datetime-local"
            value={departure}
            onChange={(e) => setDeparture(e.target.value)}
            required
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Close
        </Button>
      </div>
      {trip.source?.kind === 'schedule' && (
        <p className="text-[12px] text-muted-foreground lg:hidden">
          Changes this day only. The recurring schedule is unchanged.
        </p>
      )}
    </form>
  );
}
