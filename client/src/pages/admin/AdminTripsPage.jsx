import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CalendarClock, Trash2 } from 'lucide-react';
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
import { PageHeader } from '@/components/layout/AppLayout.jsx';
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

export default function AdminTripsPage() {
  const routes = useList(listRoutes);
  const buses = useList(listBuses);
  const conductors = useList(listConductors);
  const trips = useList(() => listTrips('?limit=60').then((r) => r.trips));

  const [form, setForm] = useState({
    routeId: '',
    busId: '',
    conductorId: '',
    scheduledDeparture: toManilaInputValue(new Date(Date.now() + 30 * 60000)),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

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
    try {
      await fn();
      await trips.reload();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <>
      <PageHeader
        bare
        icon={CalendarClock}
        title="Trips"
        description="Scheduling a trip copies the route's checkpoints and baseline times onto it. Editing the route later will not change a trip already created."
      />

      {(error || trips.error) && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{(error ?? trips.error).message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Schedule a trip</CardTitle>
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
              {busy ? 'Scheduling…' : 'Schedule trip'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>All trips</CardTitle>
          <span className="font-mono text-xs text-muted-foreground">{trips.items.length}</span>
        </CardHeader>
        <CardContent>
          {trips.loading && <div className="py-10 text-center text-muted-foreground">Loading…</div>}
          {!trips.loading && trips.items.length === 0 && (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
              No trips scheduled yet.
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
                  {trips.items.map((trip) => (
                    <TableRow key={trip.id} className={cn(trip.isStale && 'bg-muted/60')}>
                      <TableCell>
                        <Link
                          to={`/trips/${trip.id}`}
                          className="font-semibold hover:text-primary hover:underline"
                        >
                          {trip.route.name}
                        </Link>
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
                        <StatusBadge
                          status={trip.status}
                          isStale={trip.isStale}
                          varianceMinutes={trip.varianceMinutes}
                          conditionsAllowanceMinutes={trip.conditionsAllowanceMinutes}
                        />
                      </TableCell>
                      {/* Where it actually is, which the dashboard shows and
                          this list did not — the same question, asked from a
                          different page. */}
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
                        {trip.status === 'scheduled' && (
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
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => act(() => deleteTrip(trip.id))}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Picker({ label, value, onChange, options }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select…" />
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
