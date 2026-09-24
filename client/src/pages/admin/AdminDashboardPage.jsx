import { Link } from 'react-router-dom';
import { Activity, AlertCircle, CircleSlash, Clock, LayoutDashboard } from 'lucide-react';
import { usePolling } from '@/hooks/usePolling.js';
import { fetchDashboard } from '@/api/adminApi.js';
import { StatusBadge } from '@/components/StatusBadge.jsx';
import { PageHeader, LiveIndicator } from '@/components/layout/AppLayout.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { ResponsiveTable } from '@/components/ResponsiveTable.jsx';
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
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[96px] rounded-xl sm:h-[110px]" />
          ))}
        </div>
      )}

      {counts && (
        /*
          * Two up on a phone, not four stacked slabs.
          *
          * Four full-width cards pushed the trips themselves — the thing the
          * page is for — most of a screen down. Paired, the whole census reads
          * in one glance and the list starts above the fold.
          */
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Stat label="Active" value={counts.active} icon={Activity} />
          <Stat label="In transit" value={counts.inTransit} icon={Activity} tone="text-success-strong" />
          <Stat label="Delayed" value={counts.delayed} icon={Clock} tone="text-warning-strong" />
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
              <Link to="/admin/trips" className="font-semibold text-primary-strong hover:underline">
                Schedule one →
              </Link>
            </div>
          )}

          {trips.length > 0 && (
            <ResponsiveTable
              rows={trips}
              rowKey={(trip) => trip.id}
              rowClassName={(trip) => cn(trip.isStale && 'bg-muted/60')}
              cardClassName={(trip) => cn(trip.isStale && 'border-warning/40')}
              columns={[
                {
                  key: 'route',
                  header: 'Route',
                  lead: true,
                  cell: (trip) => (
                    <>
                      <Link
                        to={`/admin/trips/${trip.id}`}
                        className="text-[15px] font-bold hover:text-primary-strong hover:underline lg:text-sm lg:font-semibold"
                      >
                        {trip.route.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        departs {formatTime(trip.scheduledDeparture)}
                      </div>
                    </>
                  ),
                },
                {
                  key: 'bus',
                  header: 'Bus',
                  className: 'font-mono text-xs',
                  cell: (trip) => (
                    <span className="font-mono text-xs">{trip.bus?.plateNumber ?? '—'}</span>
                  ),
                },
                {
                  key: 'conductor',
                  header: 'Conductor',
                  cell: (trip) => trip.conductor?.name ?? '—',
                },
                {
                  key: 'status',
                  header: 'Status',
                  wide: true,
                  cell: (trip) => (
                    <StatusBadge
                      status={trip.status}
                      isStale={trip.isStale}
                      varianceMinutes={trip.varianceMinutes}
                      conditionsAllowanceMinutes={trip.conditionsAllowanceMinutes}
                    />
                  ),
                },
                {
                  key: 'confirmed',
                  header: 'Last confirmed',
                  cell: (trip) => (
                    <>
                      {trip.lastConfirmedCheckpoint?.name ?? '—'}
                      {trip.minutesSinceLastConfirm !== null && (
                        <div className="text-xs text-muted-foreground">
                          {formatElapsed(trip.minutesSinceLastConfirm)} ago
                        </div>
                      )}
                    </>
                  ),
                },
                {
                  key: 'running',
                  header: 'Running',
                  cell: (trip) => formatVariance(trip.varianceMinutes),
                },
                {
                  key: 'arrival',
                  header: 'Arrival',
                  aside: true,
                  headClassName: 'text-right',
                  className: 'text-right font-mono tabular',
                  cell: (trip) => (
                    <span className="font-mono tabular">
                      {formatTime(
                        trip.stops.at(-1)?.projectedArrival ?? trip.stops.at(-1)?.scheduledArrival
                      )}
                    </span>
                  ),
                },
              ]}
            />
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
