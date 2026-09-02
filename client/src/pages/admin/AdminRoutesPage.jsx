import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  Check,
  HelpCircle,
  MapPin,
  Plus,
  Route as RouteIcon,
  Search,
  Loader2,
  Trash2,
  TriangleAlert,
  Wand2,
  X,
} from 'lucide-react';
import { useList } from '@/hooks/useList.js';
import {
  createCheckpoint,
  createRoute,
  deleteCheckpoint,
  deleteRoute,
  geocodePlace,
  measureRouteLegs,
  listCheckpoints,
  listRoutes,
} from '@/api/adminApi.js';
import { PageHeader } from '@/components/layout/AppLayout.jsx';
import { CheckpointMap } from '@/components/CheckpointMap.jsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { cn } from '@/lib/utils.ts';

const asHours = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

/**
 * The three kinds of place an operator actually has, in their language.
 *
 * Underneath these are two fields — a terminal and a roadside stop are both
 * `station`, because the engine only cares whether the bus dwells and whether
 * anyone can board. But a passenger badly needs to know the difference: one is
 * somewhere to wait out an hour, the other is a spot on a highway shoulder.
 */
const KINDS = {
  terminal: {
    label: 'Terminal',
    hint: 'Buses are based here and tickets are sold. Somewhere you can wait.',
    fields: { type: 'station', isTerminal: true },
  },
  stop: {
    label: 'Pick-up & drop-off point',
    hint: 'The bus stops here to let people on and off, but there is no terminal.',
    fields: { type: 'station', isTerminal: false },
  },
  timing: {
    label: 'Timing point — nobody boards',
    hint: 'A toll exit or junction the bus passes. Improves the ETA, gets no board.',
    fields: { type: 'landmark', isTerminal: false },
  },
};

const kindOf = (cp) =>
  cp.type === 'landmark' ? 'timing' : cp.isTerminal ? 'terminal' : 'stop';

/**
 * What to do, in order, for somebody who has never seen this page.
 *
 * The screen has a map, a checkpoint form, a route builder and two lists, and
 * shown all at once to a first-time user that is just noise — none of it says
 * which thing to touch first or why any of it exists. This narrates the three
 * steps, marks where you actually are, and collapses itself once you have a
 * working route, because after that it is clutter.
 */
function GettingStarted({ checkpointCount, routeCount, stopsInBuilder }) {
  const [open, setOpen] = useState(true);

  const steps = [
    {
      title: 'Place your stops',
      body: 'Click the map where a bus actually pulls in, or search for it by name. A stop is anywhere a bus stops or passes — a terminal, a roadside pick-up point, or a toll exit used only for timing.',
      done: checkpointCount >= 2,
      active: checkpointCount < 2,
    },
    {
      title: 'Put them in order',
      body: 'Click your pins in the order the bus drives them. The first one is where the trip starts, the last is where it ends.',
      done: routeCount > 0 || stopsInBuilder >= 2,
      active: checkpointCount >= 2 && routeCount === 0 && stopsInBuilder < 2,
    },
    {
      title: 'Say how long each leg takes',
      body: 'For each stop, how many minutes the bus normally needs to get there from the one before. This is the yardstick every ETA is measured against — roughly right is fine, it corrects itself as trips run.',
      done: routeCount > 0,
      active: stopsInBuilder >= 2 && routeCount === 0,
    },
  ];

  // Once a route exists they have done this; do not keep lecturing them.
  const settled = routeCount > 0;

  if (settled && !open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mb-4 inline-flex cursor-pointer items-center gap-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
      >
        <HelpCircle className="h-3.5 w-3.5" />
        How this page works
      </button>
    );
  }

  return (
    <Card className="mb-4 border-primary/30 bg-primary/[0.03]">
      <CardContent className="p-5">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-bold">Setting up a route</h2>
            <p className="text-[13px] text-muted-foreground">
              A route is a list of stops in order, with how long the bus normally takes between
              each. Trips are then scheduled onto it.
            </p>
          </div>
          {settled && (
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Hide
            </Button>
          )}
        </div>

        <ol className="space-y-2">
          {steps.map((step, i) => (
            <li
              key={step.title}
              className={cn(
                'flex gap-3 rounded-lg p-3 transition-colors',
                step.active && 'bg-background shadow-sm ring-1 ring-primary/30'
              )}
            >
              <span
                className={cn(
                  'grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold',
                  step.done
                    ? 'bg-success text-success-foreground'
                    : step.active
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                )}
              >
                {step.done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <div className="min-w-0">
                <div
                  className={cn(
                    'text-[14px] font-semibold',
                    !step.active && !step.done && 'text-muted-foreground'
                  )}
                >
                  {step.title}
                </div>
                {(step.active || open) && (
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

/**
 * Routes and the checkpoints they are made of, on one page.
 *
 * These were two separate tabs, which made the job confusing: you cannot build
 * a route without checkpoints, so being sent elsewhere to make one and then
 * back again hid the actual shape of the task. Building a route *is* placing
 * points in order, so both happen here, against the same map.
 *
 * The map shows fixed places only. Nothing about a bus appears on it.
 */
export default function AdminRoutesPage() {
  const routes = useList(listRoutes);
  const checkpoints = useList(listCheckpoints);
  const [error, setError] = useState(null);

  const [name, setName] = useState('');
  const [stops, setStops] = useState([]); // [{ id, name, minutes }]
  const [saving, setSaving] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [measureNote, setMeasureNote] = useState(null);

  const [draftPin, setDraftPin] = useState(null);
  const [suggested, setSuggested] = useState(null);
  const [previewRouteId, setPreviewRouteId] = useState(null);
  // Set only when the map should move on purpose — a search result. Clicking
  // the map must never move it.
  const [focusOn, setFocusOn] = useState(null);

  const byId = useMemo(
    () => new Map(checkpoints.items.map((c) => [c._id, c])),
    [checkpoints.items]
  );

  const totalMinutes = stops.reduce((sum, s, i) => sum + (i === 0 ? 0 : Number(s.minutes) || 0), 0);

  const chosen = stops.map((s) => byId.get(s.id)).filter(Boolean);
  const unplaced = checkpoints.items.filter((c) => c.location?.lat == null);

  const previewRoute = routes.items.find((r) => r._id === previewRouteId);
  const previewPath = previewRoute
    ? previewRoute.checkpoints.map((e) => e.checkpoint).filter(Boolean)
    : chosen;

  /**
   * Fill in the travel times rather than making someone guess them.
   *
   * Typing a baseline per leg is the tedious part of setting a route up, and a
   * wrong one quietly corrupts every ETA on it. These come back editable on
   * purpose: an operator knows things a routing engine does not — a terminal
   * that always takes ten minutes to get out of, market day, a school zone.
   */
  const estimateTimes = async () => {
    setMeasuring(true);
    setMeasureNote(null);
    try {
      const { legs } = await measureRouteLegs(stops.map((s) => s.id));

      setStops((current) =>
        current.map((stop, i) => {
          const leg = legs[i];
          if (!leg?.measured || i === 0) return stop;
          return { ...stop, minutes: String(leg.baselineMinutes), estimated: true };
        })
      );

      const missed = legs.filter((l) => !l.measured);
      setMeasureNote(
        missed.length
          ? `Estimated all but ${missed.length} leg${missed.length === 1 ? '' : 's'} — ${missed[0].reason}`
          : 'Estimated from typical traffic. Adjust any leg you know runs differently.'
      );
    } catch (err) {
      setMeasureNote(err.message);
    } finally {
      setMeasuring(false);
    }
  };

  const addStop = (id) => {
    if (!id || stops.some((s) => s.id === id)) return;
    setStops([...stops, { id, minutes: stops.length === 0 ? 0 : '' }]);
    setPreviewRouteId(null);
  };

  const saveRoute = async (e) => {
    e.preventDefault();
    setError(null);

    if (stops.length < 2) {
      setError(new Error('A route needs at least a start and an end.'));
      return;
    }

    setSaving(true);
    try {
      await createRoute({
        name,
        checkpoints: stops.map((s, i) => ({
          checkpoint: s.id,
          // The first stop has nothing before it, so its baseline is always 0.
          baselineMinutesFromPrevious: i === 0 ? 0 : Number(s.minutes) || 0,
        })),
      });
      setName('');
      setStops([]);
      await routes.reload();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        icon={RouteIcon}
        title="Routes & checkpoints"
        description="A route is an ordered chain of checkpoints with the usual travel time between each. Place the points on the map, put them in order, and give each leg its normal duration."
      />

      <GettingStarted
        checkpointCount={checkpoints.items.length}
        routeCount={routes.items.length}
        stopsInBuilder={stops.length}
      />

      {(error || routes.error || checkpoints.error) && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {(error ?? routes.error ?? checkpoints.error).message}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_420px]">
        {/* ------------------------------------------------------------ map */}
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>
              {previewRoute ? `Route: ${previewRoute.name}` : 'Click the map to add a checkpoint'}
            </CardTitle>
            {previewRoute && (
              <Button variant="ghost" size="sm" onClick={() => setPreviewRouteId(null)}>
                Back to editing
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <div className="border-b border-border p-4">
              <PlaceSearch
                onPick={(hit) => {
                  setDraftPin(hit.location);
                  setSuggested({ name: hit.name, area: hit.area, hit });
                  // A search result is a deliberate "take me there".
                  setFocusOn(hit.location);
                }}
              />
            </div>
            <CheckpointMap
              checkpoints={checkpoints.items.map((c) => ({ ...c, id: c._id }))}
              routePath={previewPath}
              draft={draftPin}
              focusOn={focusOn}
              // Re-frame only when a route is previewed, never on a pin drop.
              fitKey={previewRouteId}
              onPick={previewRoute ? null : setDraftPin}
              onSelect={previewRoute ? null : (cp) => addStop(cp.id ?? cp._id)}
              height={420}
              className="rounded-none border-0 border-b"
            />
            <div className="px-5 py-3 text-xs text-muted-foreground">
              Search a place above, or click an empty spot to place a checkpoint · click an
              existing pin to add it to the route being built
            </div>
          </CardContent>
        </Card>

        {/* --------------------------------------------------------- builder */}
        <div className="space-y-4">
          <NewCheckpointCard
            draftPin={draftPin}
            suggested={suggested}
            onClear={() => {
              setDraftPin(null);
              setSuggested(null);
            }}
            onCreated={async (created) => {
              setDraftPin(null);
              setSuggested(null);
              await checkpoints.reload();
              addStop(created._id);
            }}
            onError={setError}
          />

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Build a route</CardTitle>
              {totalMinutes > 0 && (
                <span className="font-mono text-xs text-muted-foreground">
                  {asHours(totalMinutes)} total
                </span>
              )}
            </CardHeader>
            <CardContent>
              <form onSubmit={saveRoute} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="route-name">Route name</Label>
                  <Input
                    id="route-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Cubao – Baguio"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label>Stops, in the order the bus drives them</Label>

                  {stops.length === 0 && (
                    <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                      Nothing added yet. Click pins on the map, or pick from the list below — the
                      first one you add is where the bus starts.
                    </p>
                  )}

                  <ol className="space-y-2">
                    {stops.map((stop, i) => {
                      const cp = byId.get(stop.id);
                      const isFirst = i === 0;
                      const isLast = i === stops.length - 1;

                      return (
                        <li key={stop.id}>
                          {!isFirst && (
                            <div className="flex items-center gap-2 py-1 pl-3 text-xs text-muted-foreground">
                              <ArrowDown className="h-3 w-3" />
                              <Input
                                type="number"
                                min="0"
                                className="h-8 w-20"
                                value={stop.minutes}
                                onChange={(e) =>
                                  setStops(
                                    stops.map((s, j) =>
                                      j === i ? { ...s, minutes: e.target.value } : s
                                    )
                                  )
                                }
                                placeholder="0"
                              />
                              <span>min drive, normally</span>
                            </div>
                          )}

                          <div className="flex items-center gap-2 rounded-lg border border-border p-2.5">
                            <span
                              className={cn(
                                'grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold',
                                isFirst || isLast
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-muted text-muted-foreground'
                              )}
                            >
                              {i + 1}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold">
                                {cp?.name ?? 'Unknown'}
                              </span>
                              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                {isFirst ? 'Start' : isLast ? 'End' : cp?.type}
                                {cp?.location?.lat == null && ' · no pin yet'}
                              </span>
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              onClick={() => setStops(stops.filter((_, j) => j !== i))}
                              aria-label={`Remove ${cp?.name}`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ol>

                  <Select value="" onValueChange={addStop}>
                    <SelectTrigger>
                      <SelectValue placeholder="+ Add an existing checkpoint…" />
                    </SelectTrigger>
                    <SelectContent>
                      {checkpoints.items
                        .filter((c) => !stops.some((s) => s.id === c._id))
                        .map((c) => (
                          <SelectItem key={c._id} value={c._id}>
                            {c.name}
                            {c.type === 'landmark' ? ' (timing point)' : ''}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Offered before the save, because it fills the fields above it. */}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={measuring || stops.length < 2}
                  onClick={estimateTimes}
                >
                  {measuring ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="mr-1.5 h-4 w-4" />
                  )}
                  {measuring ? 'Measuring…' : 'Estimate travel times'}
                </Button>

                {measureNote && (
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    {measureNote}
                  </p>
                )}

                <Button type="submit" className="w-full" disabled={saving || stops.length < 2}>
                  {saving ? 'Saving…' : `Create route with ${stops.length} stops`}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ------------------------------------------------------ existing data */}
      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Existing routes</CardTitle>
          <span className="font-mono text-xs text-muted-foreground">{routes.items.length}</span>
        </CardHeader>
        <CardContent className="space-y-3">
          {routes.items.length === 0 && !routes.loading && (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
              No routes yet.
            </div>
          )}

          {routes.items.map((route) => {
            const mins = route.checkpoints.reduce(
              (s, c) => s + (c.baselineMinutesFromPrevious || 0),
              0
            );
            return (
              <div key={route._id} className="rounded-xl border border-border p-4">
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div>
                    <div className="font-bold">{route.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {route.checkpoints.length} checkpoints · {asHours(mins)} baseline
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPreviewRouteId(route._id)}>
                      <MapPin className="mr-1.5 h-3.5 w-3.5" />
                      Show on map
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={async () => {
                        try {
                          await deleteRoute(route._id);
                          await routes.reload();
                        } catch (err) {
                          setError(err);
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {route.checkpoints.map((entry, i) => (
                    <span key={entry.checkpoint?._id ?? i} className="inline-flex items-center gap-2">
                      {i > 0 && (
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {entry.baselineMinutesFromPrevious}m
                        </span>
                      )}
                      <span
                        className={cn(
                          'rounded-lg border bg-muted/40 px-2.5 py-1 text-[13px]',
                          entry.checkpoint?.type === 'landmark' &&
                            'border-dashed text-muted-foreground'
                        )}
                      >
                        {entry.checkpoint?.name ?? 'Unknown'}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>All checkpoints</CardTitle>
          <span className="font-mono text-xs text-muted-foreground">
            {checkpoints.items.length}
            {unplaced.length > 0 && ` · ${unplaced.length} without a pin`}
          </span>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {checkpoints.items.map((cp) => (
              <span
                key={cp._id}
                className="inline-flex items-center gap-2 rounded-lg border border-border py-1 pl-2.5 pr-1 text-[13px]"
              >
                <MapPin
                  className={cn(
                    'h-3 w-3',
                    cp.location?.lat != null ? 'text-primary' : 'text-muted-foreground/50'
                  )}
                />
                {cp.name}
                <Badge
                  variant={cp.type === 'landmark' ? 'muted' : cp.isTerminal ? 'default' : 'secondary'}
                  className="text-[10px]"
                >
                  {KINDS[kindOf(cp)].label.split(' —')[0]}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={async () => {
                    try {
                      await deleteCheckpoint(cp._id);
                      await checkpoints.reload();
                    } catch (err) {
                      setError(err);
                    }
                  }}
                  aria-label={`Delete ${cp.name}`}
                >
                  <X className="h-3 w-3" />
                </Button>
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

/**
 * Type a place name and drop a pin on it.
 *
 * Backed by OpenStreetMap's free lookup, proxied through our own server so the
 * rate limit is honoured centrally. It costs nothing and shares no quota with
 * the traffic provider — worst case the search returns nothing and the map
 * click still works.
 */
function PlaceSearch({ onPick }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);

  // Debounced: one lookup after typing stops, not one per keystroke. The free
  // service asks for at most a request per second and this is how we stay well
  // inside that.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) {
      setResults([]);
      return undefined;
    }

    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await geocodePlace(term);
        if (seq.current === mine) setResults(res.results ?? []);
      } catch {
        if (seq.current === mine) setResults([]);
      } finally {
        if (seq.current === mine) setSearching(false);
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [q]);

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Find a place — e.g. “Balintawak” or “PITX”"
        className="pl-9"
      />
      {searching && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          searching…
        </span>
      )}

      {results.length > 0 && (
        <ul className="absolute z-[1000] mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-popover shadow-lg">
          {results.map((hit, i) => (
            <li key={i}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left hover:bg-muted"
                onClick={() => {
                  onPick(hit);
                  setQ('');
                  setResults([]);
                }}
              >
                <span className="block text-sm font-semibold">{hit.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{hit.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Turns a dropped pin into a named checkpoint without leaving the page. */
function NewCheckpointCard({ draftPin, suggested, onClear, onCreated, onError }) {
  const [form, setForm] = useState({ name: '', type: 'station', area: '', isTerminal: false });
  const [busy, setBusy] = useState(false);

  // A pin from the search box already knows what the place is called, so the
  // form arrives filled in rather than blank.
  useEffect(() => {
    if (suggested) {
      setForm((f) => ({ ...f, name: suggested.name ?? '', area: suggested.area ?? '' }));
    }
  }, [suggested]);

  if (!draftPin) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex items-center gap-3 p-5 text-sm text-muted-foreground">
          <Plus className="h-4 w-4 shrink-0" />
          Click anywhere on the map to place a new checkpoint.
        </CardContent>
      </Card>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const created = await createCheckpoint({ ...form, location: draftPin });
      setForm({ name: '', type: 'station', area: '', isTerminal: false });
      onCreated(created);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-primary/40">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" />
          New checkpoint here
        </CardTitle>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClear}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <p className="font-mono text-xs text-muted-foreground">
            {draftPin.lat.toFixed(4)}, {draftPin.lng.toFixed(4)}
          </p>

          {/*
            * The single most damaging data mistake here is siting a stop at a
            * town centre. The bus never goes there, so the pin is wrong, the
            * walking directions are wrong, and the measured leg detours off
            * the highway — which makes the baseline wrong too.
            */}
          {suggested?.hit && !suggested.hit.isTransit && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/15 px-3 py-2 text-[13px]">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning-strong" />
              <span>
                <strong className="font-bold">This is a {suggested.hit.kind.toLowerCase()}.</strong>{' '}
                Buses may not actually stop here. A checkpoint should be a terminal or a
                roadside stop the bus really pulls into — drag the pin onto it if you are not
                sure.
              </span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="cp-name">Name</Label>
            <Input
              id="cp-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Balintawak"
              autoFocus
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cp-area">Area (helps people who don't know the place)</Label>
            <Input
              id="cp-area"
              value={form.area}
              onChange={(e) => setForm({ ...form, area: e.target.value })}
              placeholder="Quezon City, Metro Manila"
            />
          </div>

          <div className="space-y-2">
            <Label>What kind of place is this?</Label>
            <Select
              value={kindOf(form)}
              onValueChange={(v) => setForm({ ...form, ...KINDS[v].fields })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(KINDS).map(([value, k]) => (
                  <SelectItem key={value} value={value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{KINDS[kindOf(form)].hint}</p>
          </div>

          <Button type="submit" className="w-full" disabled={busy}>
            <Check className="mr-1.5 h-4 w-4" />
            {busy ? 'Adding…' : 'Add & put in route'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
