import { Link } from 'react-router-dom';
import { Activity, AlertCircle, CircleSlash, Clock, LayoutDashboard } from 'lucide-react';
import { usePolling } from '@/hooks/usePolling.js';
import { fetchDashboard } from '@/api/adminApi.js';
import { StatusBadge } from '@/components/StatusBadge.jsx';
import { PageHeader, LiveIndicator } from '@/components/layout/AppLayout.jsx';
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
import { formatElapsed, formatTime, formatVariance } from '@/utils/time.js';

/**
 * The operator's view of the whole system. The counts across the top are
 * deliberately not just a trip census: "not reporting" sits alongside them
 * because a silent bus is an operational problem of a different kind from a
 * late one, and it is the one nobody notices without being told.
 */
export default function AdminDashboardPage() {
  const { data, error, loading, lastUpdated } = usePolling(fetchDashboard, { intervalMs: 15000 });

  const counts = data?.counts;
  const trips = data?.trips ?? [];

  return (
    <>
      <PageHeader
        bare
        icon={LayoutDashboard}
        title="Today's trips"
        description="Everything currently scheduled or under way."
        actions={<LiveIndicator lastUpdated={lastUpdated} />}
      />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {loading && !data && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[110px] rounded-xl" />
          ))}
        </div>
      )}

      {counts && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Active" value={counts.active} icon={Activity} />
          <Stat label="In transit" value={counts.inTransit} icon={Activity} tone="text-success" />
          <Stat label="Delayed" value={counts.delayed} icon={Clock} tone="text-warning" />
          <Stat
            label="Not reporting"
            value={counts.stale}
            icon={CircleSlash}
            tone="text-muted-foreground"
          />
        </div>
      )}

      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Active trips</CardTitle>
          <span className="font-mono text-xs text-muted-foreground">{trips.length} total</span>
        </CardHeader>
        <CardContent>
          {data && trips.length === 0 && (
            <div className="rounded-xl border border-dashed py-14 text-center text-muted-foreground">
              No active trips.{' '}
              <Link to="/admin/trips" className="font-semibold text-primary hover:underline">
                Schedule one →
              </Link>
            </div>
          )}

          {trips.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Route</TableHead>
                    <TableHead>Bus</TableHead>
                    <TableHead>Conductor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last confirmed</TableHead>
                    <TableHead>Running</TableHead>
                    <TableHead className="text-right">Arrival</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trips.map((trip) => (
                    <TableRow key={trip.id} className={cn(trip.isStale && 'bg-muted/60')}>
                      <TableCell>
                        <Link
                          to={`/trips/${trip.id}`}
                          className="font-semibold hover:text-primary hover:underline"
                        >
                          {trip.route.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          departs {formatTime(trip.scheduledDeparture)}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {trip.bus?.plateNumber ?? '—'}
                      </TableCell>
                      <TableCell>{trip.conductor?.name ?? '—'}</TableCell>
                      <TableCell>
                        <StatusBadge
                          status={trip.status}
                          isStale={trip.isStale}
                          varianceMinutes={trip.varianceMinutes}
                          conditionsAllowanceMinutes={trip.conditionsAllowanceMinutes}
                        />
                      </TableCell>
                      <TableCell>
                        {trip.lastConfirmedCheckpoint?.name ?? '—'}
                        {trip.minutesSinceLastConfirm !== null && (
                          <div className="text-xs text-muted-foreground">
                            {formatElapsed(trip.minutesSinceLastConfirm)} ago
                          </div>
                        )}
                      </TableCell>
                      <TableCell>{formatVariance(trip.varianceMinutes)}</TableCell>
                      <TableCell className="text-right font-mono tabular">
                        {formatTime(
                          trip.stops.at(-1)?.projectedArrival ?? trip.stops.at(-1)?.scheduledArrival
                        )}
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

function Stat({ label, value, icon: Icon, tone }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </div>
          <Icon className={cn('h-4 w-4 text-muted-foreground', tone)} />
        </div>
        <div className={cn('mt-2 tabular text-[34px] font-extrabold leading-none tracking-[-0.02em]', tone)}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
