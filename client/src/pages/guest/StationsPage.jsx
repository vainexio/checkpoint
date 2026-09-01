import { Link } from 'react-router-dom';
import { ArrowRight, Bus, MapPin, Route as RouteIcon } from 'lucide-react';
import { usePolling } from '@/hooks/usePolling.js';
import { fetchRoutes, fetchStations } from '@/api/publicApi.js';
import { PageHeader } from '@/components/layout/AppLayout.jsx';
import { Card, CardContent } from '@/components/ui/card.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';

/**
 * The guest entry point: pick where you are waiting.
 *
 * No account, no download, no permission prompt. A passenger standing at a
 * terminal should be one tap from the board for that terminal.
 */
export default function StationsPage() {
  const stations = usePolling(fetchStations, { intervalMs: 120000 });
  const routes = usePolling(fetchRoutes, { intervalMs: 120000 });

  const terminals = (stations.data ?? []).filter((s) => s.isTerminal);
  const stops = (stations.data ?? []).filter((s) => !s.isTerminal);

  return (
    <>
      <PageHeader
        icon={Bus}
        title="Where are you waiting?"
        description="Choose a stop to see every bus currently heading there, with a live arrival time for each."
      />

      {stations.loading && !stations.data && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[76px] rounded-xl" />
          ))}
        </div>
      )}

      {terminals.length > 0 && (
        <Section title="Terminals">
          {terminals.map((station) => (
            <StationCard key={station.id} station={station} />
          ))}
        </Section>
      )}

      {stops.length > 0 && (
        <Section title="Stops along the way">
          {stops.map((station) => (
            <StationCard key={station.id} station={station} />
          ))}
        </Section>
      )}

      {routes.data?.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Or browse by route
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {routes.data.map((route) => (
              <Card key={route.id}>
                <CardContent className="flex items-start gap-3 p-5">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-accent/15 text-primary">
                    <RouteIcon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold">{route.name}</div>
                    <div className="mt-0.5 text-sm text-muted-foreground">
                      {route.origin} → {route.destination}
                    </div>
                    <div className="mt-1 font-mono text-xs text-muted-foreground">
                      {route.stopCount} checkpoints
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function Section({ title, children }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

function StationCard({ station }) {
  return (
    <Link to={`/stations/${station.id}`} className="group">
      <Card className="h-full transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
        <CardContent className="flex items-center justify-between gap-3 p-5">
          <span className="flex items-center gap-3">
            <MapPin className="h-4 w-4 shrink-0 text-primary" />
            <span className="text-[17px] font-bold">{station.name}</span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        </CardContent>
      </Card>
    </Link>
  );
}
