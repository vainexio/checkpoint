import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Bus,
  Crosshair,
  Footprints,
  Loader2,
  MapPin,
  Search,
  X,
} from 'lucide-react';
import { directionsUrl, walkMinutes } from '@/utils/directions.js';
import { usePolling } from '@/hooks/usePolling.js';
import { fetchMapData, fetchNearbyStations, fetchStations } from '@/api/publicApi.js';
import { PageHeader } from '@/components/layout/AppLayout.jsx';
import { CheckpointMap } from '@/components/CheckpointMap.jsx';
import { JourneyPlanner } from '@/components/JourneyPlanner.jsx';
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
/**
 * Past this, a fix is a guess about which city you are in, not which street —
 * well beyond the 25 km radius the nearby search works in, so distances built
 * on it stop meaning anything.
 */
const COARSE_FIX_METRES = 2000;

export default function StationsPage() {
  const stations = usePolling(fetchStations, { intervalMs: 120000 });
  const map = usePolling(fetchMapData, { intervalMs: 300000 });

  const [query, setQuery] = useState('');
  const [nearby, setNearby] = useState(null); // { radiusKm, within, fallback }
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
  const findNearby = ({ listStops = true } = {}) => {
    if (!navigator.geolocation) {
      setLocationError('This browser cannot share a location.');
      return;
    }

    setLocating(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        /*
         * `accuracy` is metres of radius, and it is not decoration.
         *
         * Without a GPS chip the browser falls back to WiFi and then to IP,
         * and an IP fix lands on the ISP's exchange — routinely tens of
         * kilometres out. Dropping the figure meant a guess that good as a
         * street address and a guess accurate to half a province were drawn as
         * the same confident dot, and then fed to a 25 km "near me" search.
         */
        const here = { lat: coords.latitude, lng: coords.longitude, accuracyM: coords.accuracy };
        setYou(here);
        // The journey planner only needs the fix itself; asking for the nearby
        // list as well would scroll the page to a section nobody asked for.
        if (!listStops) {
          setLocating(false);
          return;
        }
        try {
          const res = await fetchNearbyStations(here.lat, here.lng);
          setNearby(res);
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
      // Worth the extra seconds and battery: this decides which curb someone
      // is sent to walk to.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
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
        title="Where are you going?"
        description="Pick a destination to see which buses can take you there and where to catch them — or find a stop to see everything heading its way."
      />

      {/* --------------------------------------------------- journey planner */}
      <JourneyPlanner
        stations={all}
        you={you}
        locating={locating}
        onRequestLocation={() => findNearby({ listStops: false })}
      />

      {/* ------------------------------------------------------------ search */}
      <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
        Or find a stop
      </h2>
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

      {/*
        * Say when the fix is too coarse to act on, rather than letting the map
        * imply a precision it does not have.
        */}
      {you?.accuracyM > COARSE_FIX_METRES && (
        <p className="mb-4 text-sm text-muted-foreground">
          Your device could only place you to within about{' '}
          <span className="font-semibold text-foreground">
            {Math.round(you.accuracyM / 1000)} km
          </span>{' '}
          — probably a network lookup rather than GPS, so distances below are rough. Searching by
          stop name will be more reliable.
        </p>
      )}

      {/* --------------------------------------------------------------- map */}
      <Card className="mb-8 overflow-hidden">
        <CardContent className="p-0">
          <CheckpointMap
            checkpoints={mapCheckpoints}
            routePath={routePath}
            you={you}
            // Re-frame when what is being shown changes, not on every render.
            fitKey={matches ? `search:${query}` : nearby ? 'nearby' : 'all'}
            height={320}
            className="rounded-none border-0"
          />
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border px-5 py-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-[#1d4ed8]">
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
              </span>
              Terminal — buses based here, somewhere to wait
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#3b82f6]" /> Pick-up &amp; drop-off point
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-dashed border-muted-foreground" />{' '}
              Timing point — nobody boards
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

      {nearby &&
        (nearby.within.length > 0 ? (
          <Section title={`Stops within ${nearby.radiusKm} km of you`}>
            {nearby.within.map((s) => (
              <StationCard key={s.id} station={s} you={you} />
            ))}
          </Section>
        ) : (
          /*
           * Sorting by distance always produces a "nearest", but calling a stop
           * 60 km away "near you" is a lie a passenger would act on. When
           * nothing is actually close, say so plainly and offer the closest as
           * what it is — the most realistic option, not a nearby one.
           */
          <Section title="Nothing close to you">
            <div className="col-span-full mb-1 rounded-xl border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
              No stops within {nearby.radiusKm} km of where you are. This route network only
              covers Cubao–Baguio for now. The most realistic options are below — you would need
              to travel to reach them.
            </div>
            {nearby.fallback.map((s) => (
              <StationCard key={s.id} station={s} you={you} far />
            ))}
          </Section>
        ))}

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
            <Section title="Pick-up &amp; drop-off points">
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

function StationCard({ station, you = null, far = false }) {
  const walk = walkMinutes(station.distanceKm);
  const directions = directionsUrl(station.location, you);

  return (
    <Card className="group h-full transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
      <Link to={`/stations/${station.id}`} className="block">
        <CardContent className="flex items-center justify-between gap-3 p-5 pb-3">
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
                <Badge variant={far ? 'muted' : 'secondary'} className="mt-1.5">
                  {station.distanceKm} km
                  {far ? ' away · not nearby' : walk ? ` · about ${walk} min walk` : ' away'}
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
      </Link>

      {directions && (
        <div className="px-5 pb-4">
          <a
            href={directions}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
          >
            <Footprints className="h-3.5 w-3.5" />
            Walking directions
          </a>
        </div>
      )}
    </Card>
  );
}
