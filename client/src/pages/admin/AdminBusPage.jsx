import { Link, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Bus, CalendarSync, History } from 'lucide-react';
import { usePolling } from '@/hooks/usePolling.js';
import { fetchBus } from '@/api/adminApi.js';
import { StatusBadge } from '@/components/StatusBadge.jsx';
import { PageHeader } from '@/components/layout/AppLayout.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table.tsx';
import { cn } from '@/lib/utils.ts';
import { formatDay, formatTime, formatVariance } from '@/utils/time.js';
import { describeDays, formatClock } from './ScheduleManager.jsx';

/**
 * One bus, from the two directions an operator asks about it: what it is
 * booked to do, and what it has actually been doing.
 *
 * The fleet list answers "which buses exist", which is the least interesting
 * question anyone has about a particular bus. Standing in front of it, or on
 * the phone about it, what you want is today and the days after — and then,
 * when someone asks whether this bus runs late, a record rather than an
 * impression.
 */
export default function AdminBusPage() {
  const { busId } = useParams();
  const { data, error, loading } = usePolling(() => fetchBus(busId), {
    intervalMs: 60000,
    deps: [busId],
  });

  const back = (
    <Link
      to="/admin/fleet"
      className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Fleet &amp; crew
    </Link>
  );

  if (error) {
    return (
      <>
        {back}
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Could not load this bus. {error.message}</AlertDescription>
        </Alert>
      </>
    );
  }

  if (loading && !data) {
    return (
      <>
        {back}
        <Skeleton className="mb-4 h-24 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </>
    );
  }

  const { bus, schedules, upcoming, history } = data;
  const days = groupByDay(upcoming);
  const record = summarise(history);

  return (
    <>
      {back}
      <PageHeader
        bare
        icon={Bus}
        title={bus.plateNumber}
        description={`${bus.operatorName}${bus.isActive ? '' : ' · retired'}`}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarSync className="h-4 w-4 text-primary-strong" />
                Timetable
              </CardTitle>
              <p className="text-[13px] text-muted-foreground">
                The recurring departures this bus runs.
              </p>
            </CardHeader>
            <CardContent>
              {schedules.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No recurring schedule uses this bus. Its trips are entered by hand.
                </p>
              ) : (
                <ul className="space-y-3">
                  {schedules.map((s) => (
                    <li key={s.id} className="flex items-start gap-3">
                      <span className="w-[76px] shrink-0 font-mono text-[15px] font-bold tabular">
                        {formatClock(s.departureTime)}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-semibold">{s.route?.name ?? '—'}</span>
                        <span className="block text-[13px] text-muted-foreground">
                          {describeDays(s.daysOfWeek)}
                          {s.conductor?.name && ` · ${s.conductor.name}`}
                          {!s.isActive && ' · paused'}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-4 w-4 text-primary-strong" />
                How it has been running
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-[13px]">
              {record.completed === 0 ? (
                <p className="text-muted-foreground">
                  No completed trips yet, so there is nothing to judge it by.
                </p>
              ) : (
                <>
                  <Fact label="Trips completed">{record.completed}</Fact>
                  <Fact label="Arrived within 5 min">
                    {record.onTime} of {record.completed}
                  </Fact>
                  <Fact label="Typical finish">{formatVariance(record.medianVariance)}</Fact>
                  {record.cancelled > 0 && <Fact label="Ended early">{record.cancelled}</Fact>}
                  {record.didNotRun > 0 && <Fact label="Never left">{record.didNotRun}</Fact>}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Booked for the days ahead</CardTitle>
              <p className="text-[13px] text-muted-foreground">
                Every trip this bus is assigned to, from today onwards.
              </p>
            </CardHeader>
            <CardContent>
              {days.length === 0 ? (
                <div className="rounded-xl border border-dashed py-10 text-center text-muted-foreground">
                  Nothing booked for this bus.
                </div>
              ) : (
                <div className="space-y-5">
                  {days.map((day) => (
                    <div key={day.label}>
                      <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                        {day.label}
                      </h3>
                      <ul className="divide-y divide-border rounded-xl border border-border">
                        {day.trips.map((trip) => (
                          <li key={trip.id} className="flex items-center gap-3 p-3">
                            <span className="w-[76px] shrink-0 font-mono text-[15px] font-bold tabular">
                              {formatTime(trip.scheduledDeparture)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <Link
                                to={`/admin/trips/${trip.id}`}
                                className="block truncate font-semibold hover:text-primary-strong hover:underline"
                              >
                                {trip.route.name}
                              </Link>
                              <span className="block truncate text-[13px] text-muted-foreground">
                                {trip.conductor?.name ?? 'No conductor'}
                                {trip.source?.kind === 'schedule' ? ' · recurring' : ' · one-off'}
                              </span>
                            </span>
                            <TripState trip={trip} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Trip record</CardTitle>
              <p className="text-[13px] text-muted-foreground">
                What this bus actually ran, most recent first.
              </p>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <div className="rounded-xl border border-dashed py-10 text-center text-muted-foreground">
                  No trips before today.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Day</TableHead>
                        <TableHead>Route</TableHead>
                        <TableHead>Left</TableHead>
                        <TableHead>Arrived</TableHead>
                        <TableHead>Finished</TableHead>
                        <TableHead>State</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((trip) => (
                        <TableRow key={trip.id}>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {formatDay(trip.scheduledDeparture)}
                          </TableCell>
                          <TableCell>
                            <Link
                              to={`/admin/trips/${trip.id}`}
                              className="font-semibold hover:text-primary-strong hover:underline"
                            >
                              {trip.route.name}
                            </Link>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">
                            {trip.actualDeparture ? formatTime(trip.actualDeparture) : '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">
                            {trip.actualArrival ? formatTime(trip.actualArrival) : '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">
                            {trip.status === 'arrived'
                              ? formatVariance(trip.finalVarianceMinutes ?? trip.varianceMinutes)
                              : '—'}
                          </TableCell>
                          <TableCell>
                            <TripState trip={trip} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

/** Today, Tomorrow, then the date — the way a roster is read. */
function groupByDay(trips, now = new Date()) {
  const label = (value) => {
    const day = formatDay(value);
    if (day === formatDay(now)) return 'Today';
    if (day === formatDay(new Date(now.getTime() + 24 * 60 * 60 * 1000))) return 'Tomorrow';
    return day;
  };

  const days = [];
  for (const trip of trips) {
    const name = label(trip.scheduledDeparture);
    if (days.at(-1)?.label !== name) days.push({ label: name, trips: [] });
    days.at(-1).trips.push(trip);
  }
  return days;
}

/**
 * What became of a trip, in one phrase. Deliberately not the passenger badge:
 * an operator looking down a record wants the outcome, not a countdown.
 */
function TripState({ trip }) {
  if (trip.didNotRun) return <Muted>Did not run</Muted>;
  if (trip.abandoned) return <Muted>Stopped reporting</Muted>;
  if (trip.status === 'cancelled') {
    return <Muted tone="text-destructive-strong">{trip.terminated ? 'Ended early' : 'Cancelled'}</Muted>;
  }
  if (trip.status === 'scheduled') return <Muted>{trip.boardingSince ? 'Boarding' : 'Booked'}</Muted>;
  return (
    <StatusBadge
      status={trip.status}
      isStale={trip.isStale}
      varianceMinutes={trip.varianceMinutes}
      conditionsAllowanceMinutes={trip.conditionsAllowanceMinutes}
    />
  );
}

const Muted = ({ children, tone = 'text-muted-foreground' }) => (
  <span className={cn('whitespace-nowrap text-xs font-semibold', tone)}>{children}</span>
);

function Fact({ label, children }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

/**
 * The record in numbers. The median rather than the mean, for the same reason
 * recalibration uses it: one bus held four hours at an inspection should not
 * become this bus's character.
 */
function summarise(history) {
  const finished = history.filter((t) => t.status === 'arrived');
  const variances = finished
    .map((t) => t.finalVarianceMinutes ?? t.varianceMinutes)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);

  const mid = Math.floor(variances.length / 2);
  return {
    completed: finished.length,
    onTime: finished.filter((t) => Math.abs(t.finalVarianceMinutes ?? t.varianceMinutes) <= 5).length,
    medianVariance: variances.length
      ? variances.length % 2
        ? variances[mid]
        : Math.round((variances[mid - 1] + variances[mid]) / 2)
      : 0,
    cancelled: history.filter((t) => t.status === 'cancelled').length,
    didNotRun: history.filter((t) => t.didNotRun).length,
  };
}
