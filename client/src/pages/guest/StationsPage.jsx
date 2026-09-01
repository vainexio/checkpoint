import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bus, Crosshair, Loader2, MapPin, Search, X } from 'lucide-react';
import { usePolling } from '@/hooks/usePolling.js';
import { fetchMapData, fetchNearbyStations, fetchStations } from '@/api/publicApi.js';
import { PageHeader } from '@/components/layout/AppLayout.jsx';
import { CheckpointMap } from '@/components/CheckpointMap.jsx';
import { Card, CardContent } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { cn } from '@/lib/utils.ts';

/**
 * The guest entry point: find where you are waiting.
 *
 * Three ways in, because people arrive knowing different things. Someone local
 * types the stop name. Someone standing at a curb taps "near me". A tourist who
 * knows neither can look at the map and recognise a place.
 */
export default function StationsPage() {
  const stations = usePolling(fetchStations, { intervalMs: 120000 });
  const map = usePolling(fetchMapData, { intervalMs: 300000 });

  const [query, setQuery] = useState('');
  const [nearby, setNearby] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const [you, setYou] = useState(null);

  const all = stations.data ?? [];

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return all.filter(
      (s) => s.name.toLowerCase().includes(q) || (s.area ?? '').toLowerCase().includes(q)
    );
  }, [all, query]);

  /**
   * The passenger's own position, read once, used to rank stops, and never
   * stored or sent anywhere else. This is the rider's phone, not a bus.
   */
  const findNearby = () => {
    if (!navigator.geolocation) {
      setLocationError('This browser cannot share a location.');
      return;
    }

    setLocating(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const here = { lat: coords.latitude, lng: coords.longitude };
        setYou(here);
        try {
          const res = await fetchNearbyStations(here.lat, here.lng);
          setNearby(res.stations);
          setQuery('');
        } catch (err) {
          setLocationError(err.message);
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        setLocationError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was declined. You can still search or use the map.'
            : 'Could not get your location. You can still search or use the map.'
        );
      },
      { timeout: 10000, maximumAge: 60000 }
    );
  };

  const terminals = all.filter((s) => s.isTerminal);
  const stops = all.filter((s) => !s.isTerminal);

  // What the map should draw: the search result if there is one, else everything.
  const mapCheckpoints = matches ?? map.data?.checkpoints ?? [];
  const routePath = matches ? [] : (map.data?.routes?.[0]?.path ?? []);

  return (
    <>
      <PageHeader
        icon={Bus}
        title="Where are you waiting?"
        description="Find your stop to see every bus heading there, with a live arrival time for each."
      />

      {/* ------------------------------------------------------------ search */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setNearby(null);
            }}
            placeholder="Search a stop or city — try “Baguio” or “Tarlac”"
            className="h-11 pl-9 pr-9"
            aria-label="Search stops"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <Button variant="outline" className="h-11 shrink-0" onClick={findNearby} disabled={locating}>
          {locating ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Crosshair className="mr-2 h-4 w-4" />
          )}
          {locating ? 'Finding you…' : 'Stops near me'}
        </Button>
      </div>

      {locationError && (
        <p className="mb-4 text-sm text-muted-foreground">{locationError}</p>
      )}

      {/* --------------------------------------------------------------- map */}
      <Card className="mb-8 overflow-hidden">
        <CardContent className="p-0">
          <CheckpointMap
            checkpoints={mapCheckpoints}
            routePath={routePath}
            you={you}
            height={320}
            className="rounded-none border-0"
          />
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border px-5 py-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-primary" /> Stop you can board at
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground" /> Timing point — no
              boarding
            </span>
            <span className="ml-auto">
              Stops only. Buses are not tracked on this map.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ----------------------------------------------------------- results */}
      {stations.loading && !stations.data && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[92px] rounded-xl" />
          ))}
        </div>
      )}

      {matches && (
        <Section title={`${matches.length} match${matches.length === 1 ? '' : 'es'} for “${query}”`}>
          {matches.length === 0 ? (
            <p className="col-span-full text-muted-foreground">
              Nothing matched. Try a city name, or browse the list below.
            </p>
          ) : (
            matches.map((s) => <StationCard key={s.id} station={s} />)
          )}
        </Section>
      )}

      {nearby && (
        <Section title="Nearest to you">
          {nearby.map((s) => (
            <StationCard key={s.id} station={s} />
          ))}
        </Section>
      )}

      {!matches && !nearby && (
        <>
          {terminals.length > 0 && (
            <Section title="Terminals">
              {terminals.map((s) => (
                <StationCard key={s.id} station={s} />
              ))}
            </Section>
          )}
          {stops.length > 0 && (
            <Section title="Stops along the way">
              {stops.map((s) => (
                <StationCard key={s.id} station={s} />
              ))}
            </Section>
          )}
        </>
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
          <span className="flex min-w-0 items-start gap-3">
            <MapPin className="mt-1 h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0">
              <span className="block truncate text-[17px] font-bold">{station.name}</span>
              {station.area && (
                <span className="block truncate text-[13px] text-muted-foreground">
                  {station.area}
                </span>
              )}
              {station.distanceKm != null && (
                <Badge variant="secondary" className="mt-1.5">
                  {station.distanceKm} km away
                </Badge>
              )}
            </span>
          </span>
          <ArrowRight
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              'group-hover:translate-x-0.5 group-hover:text-primary'
            )}
          />
        </CardContent>
      </Card>
    </Link>
  );
}
