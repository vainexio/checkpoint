import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, ClipboardList } from 'lucide-react';
import { usePolling } from '@/hooks/usePolling.js';
import { fetchMyTrips } from '@/api/conductorApi.js';
import { StatusBadge } from '@/components/StatusBadge.jsx';
import { PageHeader } from '@/components/layout/AppLayout.jsx';
import { Card, CardContent } from '@/components/ui/card.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { formatDay, formatTime } from '@/utils/time.js';

/** A conductor sees their own trips and nothing else. */
export default function ConductorTripsPage({ user }) {
  const { data, error, loading } = usePolling(fetchMyTrips, { intervalMs: 30000 });
  const trips = data?.trips ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        icon={ClipboardList}
        title="Your trips"
        description={`Signed in as ${user?.name ?? ''}`}
      />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {loading && !data && (
        <div className="space-y-3">
          <Skeleton className="h-[120px] rounded-xl" />
          <Skeleton className="h-[120px] rounded-xl" />
        </div>
      )}

      {data && trips.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <p className="text-lg font-bold">No trips assigned to you right now.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Your dispatcher will assign one before departure.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {trips.map((trip) => (
          <Link key={trip.id} to={`/conductor/trips/${trip.id}`} className="group block">
            <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
              <CardContent className="flex items-center justify-between gap-4 p-5">
                <div className="min-w-0">
                  <div className="text-lg font-extrabold tracking-tight">{trip.route.name}</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    {formatDay(trip.scheduledDeparture)} · departs{' '}
                    {formatTime(trip.scheduledDeparture)}
                    {trip.bus && <> · {trip.bus.plateNumber}</>}
                  </div>
                  <div className="mt-3">
                    <StatusBadge
                      status={trip.status}
                      isStale={trip.isStale}
                      varianceMinutes={trip.varianceMinutes}
                      conditionsAllowanceMinutes={trip.conditionsAllowanceMinutes}
                    />
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
