import { Fragment, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  History,
  Pencil,
  Plus,
  Route as RouteIcon,
  Trash2,
  X,
} from 'lucide-react';
import { usePolling } from '@/hooks/usePolling.js';
import { addTripLog, deleteTripLog, editTripLog, fetchTripRecord } from '@/api/adminApi.js';
import { StatusBadge } from '@/components/StatusBadge.jsx';
import { Timeline } from '@/components/Timeline.jsx';
import { PageHeader } from '@/components/layout/AppLayout.jsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
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
import {
  formatDateTime,
  formatDay,
  formatTime,
  formatVariance,
  fromManilaInputValue,
  toManilaInputValue,
} from '@/utils/time.js';
import { Picker } from './ScheduleManager.jsx';

/**
 * One trip as the dispatcher sees it: every event the conductor sent, in the
 * order the engine replays them, and the tools to put a wrong one right.
 *
 * The conductor's own undo closes after five minutes, because by then
 * passengers have acted on the board. After that, this page is how a mistake
 * gets fixed — and every fix is written to the trail at the bottom, with who
 * made it and why.
 */

const LOAD = { seats: 'Seats available', few: 'Filling up', full: 'Full' };
const DELAY = {
  traffic: 'Traffic',
  loading: 'Loading',
  breakdown: 'Breakdown',
  inspection: 'Inspection',
  weather: 'Weather',
  other: 'Other',
};
const TYPES = [
  { value: 'departed', label: 'Departed the origin' },
  { value: 'passed_checkpoint', label: 'Reached a checkpoint' },
  { value: 'left_checkpoint', label: 'Left a checkpoint' },
  { value: 'arrived', label: 'Arrived at the destination' },
  { value: 'load_report', label: 'Seat report' },
  { value: 'delayed', label: 'Delay note' },
];
const AT_CHECKPOINT = ['passed_checkpoint', 'left_checkpoint'];

/** A log as a sentence, using the names on this trip's own plan. */
function describe(log, names, stops) {
  if (!log) return '—';
  const where = log.checkpoint ? (names.get(String(log.checkpoint)) ?? 'a removed stop') : null;
  const base = {
    departed: `Departed ${stops[0]?.name ?? 'the origin'}`,
    passed_checkpoint: `Reached ${where}`,
    left_checkpoint: `Left ${where}`,
    arrived: `Arrived at ${stops.at(-1)?.name ?? 'the destination'}`,
    delayed: `Delay reported · ${DELAY[log.delayReason] ?? 'other'}`,
    load_report: `Seats · ${LOAD[log.load] ?? log.load}`,
  }[log.type];
  const load = log.load && log.type !== 'load_report' ? ` · ${LOAD[log.load].toLowerCase()}` : '';
  return `${base ?? log.type}${load}`;
}

export default function AdminTripDetailPage() {
  const { tripId } = useParams();
  const { data, error, loading, setData } = usePolling(() => fetchTripRecord(tripId), {
    intervalMs: 30000,
    deps: [tripId],
  });

  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const trip = data?.trip;
  const logs = data?.logs ?? [];
  const corrections = data?.corrections ?? [];

  const names = useMemo(
    () => new Map((trip?.stops ?? []).map((s) => [s.checkpointId, s.name])),
    [trip]
  );
  const ignored = useMemo(
    () => new Map((trip?.ignoredLogs ?? []).map((i) => [i.clientLogId, i.reason])),
    [trip]
  );

  const apply = async (fn) => {
    setBusy(true);
    setActionError(null);
    try {
      // A correction answers with the replayed record; show it at once rather
      // than waiting for the next poll.
      setData(await fn());
      return true;
    } catch (err) {
      setActionError(err);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const back = (
    <Link
      to="/admin/trips"
      className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      All trips
    </Link>
  );

  if (error && !trip) {
    return (
      <>
        {back}
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Could not load this trip. {error.message}</AlertDescription>
        </Alert>
      </>
    );
  }

  if (loading && !trip) {
    return (
      <>
        {back}
        <Skeleton className="mb-4 h-24 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </>
    );
  }

  const stops = trip.stops;

  return (
    <>
      {back}
      <PageHeader
        bare
        icon={RouteIcon}
        title={trip.route.name}
        description={`${trip.bus?.plateNumber ?? 'No bus'} · ${trip.conductor?.name ?? 'No conductor'} · scheduled ${formatDateTime(trip.scheduledDeparture)}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge
              status={trip.status}
              isStale={trip.isStale}
              varianceMinutes={trip.varianceMinutes}
              conditionsAllowanceMinutes={trip.conditionsAllowanceMinutes}
            />
            <Button variant="outline" size="sm" asChild>
              <Link to={`/trips/${trip.id}`}>
                Passenger view <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        }
      />

      {actionError && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{actionError.message}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
              <div>
                <CardTitle>Event log</CardTitle>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  In the order the ETA engine replays them. Any change here recomputes the trip
                  and is recorded below.
                </p>
              </div>
              {!adding && (
                <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add missing update
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {adding && (
                <LogEditor
                  title="Add a missing update"
                  stops={stops}
                  busy={busy}
                  onCancel={() => setAdding(false)}
                  onSave={async (body) => {
                    if (await apply(() => addTripLog(tripId, body))) setAdding(false);
                  }}
                />
              )}

              {logs.length === 0 ? (
                <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
                  Nothing has been reported for this trip yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead>
                        <TableHead>What</TableHead>
                        <TableHead>By</TableHead>
                        <TableHead className="text-right">Correct</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map((log) => {
                        const lateMinutes = Math.round(
                          (new Date(log.syncedAt) - new Date(log.reportedAt)) / 60000
                        );
                        const why = ignored.get(log.clientLogId);
                        return (
                          <Fragment key={log._id}>
                            <TableRow className={cn(why && 'bg-warning/10')}>
                              <TableCell className="whitespace-nowrap align-top">
                                <div className="font-mono text-[13px] font-semibold tabular">
                                  {formatTime(log.reportedAt)}
                                </div>
                                <div className="text-[11px] text-muted-foreground">
                                  {formatDay(log.reportedAt)}
                                </div>
                              </TableCell>
                              <TableCell className="align-top">
                                <div className="font-medium">{describe(log, names, stops)}</div>
                                {lateMinutes >= 3 && log.recordedBy !== 'admin' && (
                                  <div className="text-[12px] text-muted-foreground">
                                    Reached the server {lateMinutes} min later — sent from the
                                    offline queue
                                  </div>
                                )}
                                {why && (
                                  <div className="mt-0.5 flex items-center gap-1 text-[12px] font-medium text-foreground">
                                    <AlertTriangle className="h-3.5 w-3.5 text-warning-strong" />
                                    Ignored by the engine: {why}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="whitespace-nowrap align-top text-[13px]">
                                {log.recordedBy === 'admin' ? (
                                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold">
                                    Dispatcher
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">Conductor</span>
                                )}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-right align-top">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="mr-1.5"
                                  disabled={busy}
                                  onClick={() => setEditingId(editingId === log._id ? null : log._id)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  <span className="sr-only">Edit</span>
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={busy}
                                  aria-label="Delete update"
                                  className="text-destructive-strong hover:bg-destructive/10 hover:text-destructive-strong"
                                  onClick={() => {
                                    const reason = window.prompt(
                                      `Remove "${describe(log, names, stops)}"?\n\nThe trip will be recomputed without it. Reason (optional):`
                                    );
                                    if (reason === null) return;
                                    apply(() => deleteTripLog(tripId, log._id, reason));
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </TableCell>
                            </TableRow>
                            {editingId === log._id && (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={4} className="bg-muted/40">
                                  <LogEditor
                                    title="Correct this update"
                                    log={log}
                                    stops={stops}
                                    busy={busy}
                                    onCancel={() => setEditingId(null)}
                                    onSave={async (body) => {
                                      if (await apply(() => editTripLog(tripId, log._id, body))) {
                                        setEditingId(null);
                                      }
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-4 w-4 text-primary-strong" />
                Corrections
              </CardTitle>
            </CardHeader>
            <CardContent>
              {corrections.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This record is exactly as the conductor sent it.
                </p>
              ) : (
                <ol className="space-y-3">
                  {corrections.map((c) => (
                    <li key={c._id} className="rounded-lg border border-border p-3 text-[13px]">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span>
                          <span className="font-semibold">{c.adminName}</span>{' '}
                          {c.action === 'added' && (
                            <>added <Q>{describe(c.after, names, stops)}</Q></>
                          )}
                          {c.action === 'deleted' && (
                            <>removed <Q>{describe(c.before, names, stops)}</Q></>
                          )}
                          {c.action === 'edited' && (
                            <>
                              changed <Q>{describe(c.before, names, stops)}</Q> at{' '}
                              {formatTime(c.before?.reportedAt)} to{' '}
                              <Q>{describe(c.after, names, stops)}</Q> at{' '}
                              {formatTime(c.after?.reportedAt)}
                            </>
                          )}
                        </span>
                        <span className="whitespace-nowrap text-[12px] text-muted-foreground">
                          {formatDateTime(c.createdAt)}
                        </span>
                      </div>
                      {c.reason && (
                        <div className="mt-1 text-muted-foreground">Reason: {c.reason}</div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>As it now replays</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-[13px]">
              <Fact label="Departed">
                {trip.actualDeparture ? formatDateTime(trip.actualDeparture) : 'Not yet'}
              </Fact>
              <Fact label="Last confirmed">
                {trip.lastConfirmedCheckpoint
                  ? `${trip.lastConfirmedCheckpoint.name}, ${formatTime(trip.lastConfirmedAt)}`
                  : '—'}
              </Fact>
              <Fact label="Running">
                {trip.actualDeparture ? formatVariance(trip.varianceMinutes) : '—'}
              </Fact>
              <Fact label="Of which the road">
                {trip.conditionsAllowanceMinutes
                  ? formatVariance(trip.conditionsAllowanceMinutes)
                  : '—'}
              </Fact>
              {trip.terminated && (
                <Fact label="Ended early">
                  {DELAY[trip.terminated.reason] ?? 'Other'}
                  {trip.terminated.nearCheckpoint && `, at ${trip.terminated.nearCheckpoint}`}
                </Fact>
              )}
              {trip.abandoned && <Fact label="Closed">Stopped reporting</Fact>}
              <Fact label="Measured against">
                <Yardstick stops={stops} />
              </Fact>
              <Fact label="Source">
                {trip.source?.kind === 'schedule'
                  ? `Recurring schedule${trip.source.overridden ? ', changed for this day' : ''}`
                  : 'Entered by hand'}
              </Fact>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <Timeline stops={stops} isArrived={trip.status === 'arrived'} position={trip.position} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

const Q = ({ children }) => <span className="font-medium">“{children}”</span>;

/**
 * Which baselines this trip was judged by. A trip scheduled into rush hour is
 * measured against its route's rush-hour figures, which is why the same
 * drive can be on time at 6 PM and late at noon.
 */
function Yardstick({ stops }) {
  const legs = stops.slice(1);
  const count = (band) => legs.filter((s) => s.baselineBand === band).length;
  const am = count('amPeak');
  const pm = count('pmPeak');
  if (!am && !pm) return 'Usual times';
  const parts = [];
  if (am) parts.push(`morning rush on ${am} of ${legs.length} legs`);
  if (pm) parts.push(`evening rush on ${pm} of ${legs.length} legs`);
  return parts.join(', ').replace(/^./, (c) => c.toUpperCase());
}

function Fact({ label, children }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

/**
 * The form for both adding a missing update and correcting an existing one.
 * Editing keeps the event's type, because changing what happened is not a
 * correction — delete it and add the right one, and the trail says so.
 */
function LogEditor({ title, log = null, stops, busy, onSave, onCancel }) {
  const [type, setType] = useState(log?.type ?? 'passed_checkpoint');
  const [checkpoint, setCheckpoint] = useState(
    log?.checkpoint ? String(log.checkpoint) : (stops[1]?.checkpointId ?? '')
  );
  const [when, setWhen] = useState(toManilaInputValue(log ? new Date(log.reportedAt) : new Date()));
  const [load, setLoad] = useState(log?.load ?? '');
  const [delayReason, setDelayReason] = useState(log?.delayReason ?? 'traffic');
  const [reason, setReason] = useState('');

  const needsCheckpoint = AT_CHECKPOINT.includes(type);
  const canCarryLoad = type === 'load_report' || type === 'left_checkpoint' || type === 'departed';

  const submit = (e) => {
    e.preventDefault();
    const body = { reportedAt: fromManilaInputValue(when).toISOString(), reason };
    if (!log) body.type = type;
    if (needsCheckpoint) body.checkpoint = checkpoint;
    if (canCarryLoad) body.load = load || null;
    if (type === 'delayed') body.delayReason = delayReason;
    onSave(body);
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-background p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">{title}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} aria-label="Close">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {log ? (
          <div className="space-y-2">
            <Label>Update</Label>
            <div className="flex h-9 items-center text-sm font-medium">
              {TYPES.find((t) => t.value === type)?.label}
            </div>
          </div>
        ) : (
          <Picker label="Update" value={type} onChange={setType} options={TYPES} />
        )}

        <div className="space-y-2">
          <Label htmlFor="log-when">When (Manila time)</Label>
          <Input
            id="log-when"
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            required
          />
        </div>

        {needsCheckpoint && (
          <Picker
            label="Checkpoint"
            value={checkpoint}
            onChange={setCheckpoint}
            options={stops.map((s) => ({ value: s.checkpointId, label: s.name }))}
          />
        )}

        {canCarryLoad && (
          <Picker
            label={type === 'load_report' ? 'Seats' : 'Seats (optional)'}
            value={load}
            onChange={setLoad}
            options={Object.entries(LOAD).map(([value, label]) => ({ value, label }))}
          />
        )}

        {type === 'delayed' && (
          <Picker
            label="Delay reason"
            value={delayReason}
            onChange={setDelayReason}
            options={Object.entries(DELAY).map(([value, label]) => ({ value, label }))}
          />
        )}

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="log-reason">Why (kept in the corrections trail)</Label>
          <Input
            id="log-reason"
            value={reason}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Conductor tapped the wrong stop"
          />
        </div>
      </div>

      <Button type="submit" size="sm" disabled={busy}>
        {busy ? 'Saving…' : log ? 'Save correction' : 'Add update'}
      </Button>
    </form>
  );
}
