import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, ClipboardList, CloudOff } from 'lucide-react';
import { usePolling } from '@/hooks/usePolling.js';
import { fetchMyTrips } from '@/api/conductorApi.js';
import { StatusBadge } from '@/components/StatusBadge.jsx';
import { PageHeader } from '@/components/layout/AppLayout.jsx';
import { Card, CardContent } from '@/components/ui/card.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { formatDay, formatElapsed, formatTime } from '@/utils/time.js';

/**
 * Their roster, a day at a time. Recurring schedules put a week of trips on a
 * conductor's list, and one undivided column of them reads as though every one
 * were today.
 */
function byDay(trips, now = new Date()) {
  const today = formatDay(now);
  const tomorrow = formatDay(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const groups = [];
  for (const trip of trips) {
    const day = formatDay(trip.scheduledDeparture);
    const label = day === today ? 'Today' : day === tomorrow ? 'Tomorrow' : day;
    if (groups.at(-1)?.label !== label) groups.push({ label, trips: [] });
    groups.at(-1).trips.push(trip);
  }
  return groups;
}

/** A conductor sees their own trips and nothing else. */
export default function ConductorTripsPage({ user }) {
  const { data, error, loading, savedAt, lastUpdated } = usePolling(fetchMyTrips, {
    intervalMs: 30000,
    // Kept on the phone, so opening the app with no signal still lists them.
    cacheKey: user?.id ? `conductor:${user.id}:trips` : null,
  });
  const trips = data?.trips ?? [];
  // A refresh failed, but there is something saved to show instead.
  const offline = Boolean(data && error);
  const days = byDay(trips);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        icon={ClipboardList}
        title="Your trips"
        description={`Signed in as ${user?.name ?? ''}`}
      />

      {offline ? (
        <Alert className="mb-4 tint-muted">
          <CloudOff className="h-4 w-4" />
          <AlertDescription>
            No connection. These are your trips as of{' '}
            <strong>{formatTime(savedAt ?? lastUpdated)}</strong>; open one to keep tapping — taps are
            saved on this phone and sent when the signal returns.
          </AlertDescription>
        </Alert>
      ) : (
        error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )
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

      {days.map((group) => (
        <section key={group.label} className="mb-6">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            {group.label}
          </h2>
          <div className="space-y-3">
            {group.trips.map((trip) => (
              <Link key={trip.id} to={`/conductor/trips/${trip.id}`} className="group block">
                <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
                  <CardContent className="flex items-center justify-between gap-4 p-5">
                    <div className="min-w-0 flex-1">
                      {/*
                        * The plate leads.
                        *
                        * A conductor is walking to one specific vehicle in a yard
                        * of them, so the plate is the identifier, not a detail —
                        * it was third in a muted line, behind the day and the
                        * departure time, which is the last place to put the one
                        * thing they need to match against the bus in front of
                        * them. Set the way the passenger board sets it.
                        */}
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        {trip.bus ? (
                          <span className="inline-flex items-center rounded-lg border-2 border-foreground/15 bg-muted/60 px-2.5 py-1 font-mono text-[17px] font-bold tracking-[0.08em]">
                            {trip.bus.plateNumber}
                          </span>
                        ) : (
                          <span className="rounded-lg border-2 border-dashed border-border px-2.5 py-1 text-[13px] font-semibold text-muted-foreground">
                            No bus assigned
                          </span>
                        )}
                        <StatusBadge
                          status={trip.status}
                          isStale={trip.isStale}
                          varianceMinutes={trip.varianceMinutes}
                          conditionsAllowanceMinutes={trip.conditionsAllowanceMinutes}
                        />
                      </div>

                      <div className="text-lg font-extrabold tracking-tight">{trip.route.name}</div>
                      <div className="mt-0.5 text-sm text-muted-foreground">
                        {formatDay(trip.scheduledDeparture)} · departs{' '}
                        {formatTime(trip.scheduledDeparture)}
                        {trip.bus?.operatorName && <> · {trip.bus.operatorName}</>}
                      </div>

                      {/* Their own last report, so they can see at a glance whether
                          this trip is waiting on a tap from them. */}
                      <div className="mt-1.5 text-[13px] text-muted-foreground">
                        {trip.lastConfirmedCheckpoint ? (
                          <>
                            Last confirmed{' '}
                            <span className="font-semibold text-foreground">
                              {trip.lastConfirmedCheckpoint.name}
                            </span>
                            {trip.minutesSinceLastConfirm != null && (
                              <> · {formatElapsed(trip.minutesSinceLastConfirm)} ago</>
                            )}
                          </>
                        ) : (
                          'Nothing confirmed yet'
                        )}
                      </div>
                    </div>
                    <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary-strong" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
