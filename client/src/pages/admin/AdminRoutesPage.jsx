import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  Check,
  MapPin,
  Plus,
  Route as RouteIcon,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useList } from '@/hooks/useList.js';
import {
  createCheckpoint,
  createRoute,
  deleteCheckpoint,
  deleteRoute,
  geocodePlace,
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

  const [draftPin, setDraftPin] = useState(null);
  const [suggested, setSuggested] = useState(null);
  const [previewRouteId, setPreviewRouteId] = useState(null);

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
                  setSuggested({ name: hit.name, area: hit.area });
                }}
              />
            </div>
            <CheckpointMap
              checkpoints={checkpoints.items.map((c) => ({ ...c, id: c._id }))}
              routePath={previewPath}
              draft={draftPin}
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
                {cp.type === 'landmark' && (
                  <Badge variant="muted" className="text-[10px]">
                    timing
                  </Badge>
                )}
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
            <Label>Type</Label>
            <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="station">Stop — passengers board, gets a board</SelectItem>
                <SelectItem value="landmark">Timing point — no boarding</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={form.isTerminal}
              onChange={(e) => setForm({ ...form, isTerminal: e.target.checked })}
            />
            This is an official terminal
          </label>

          <Button type="submit" className="w-full" disabled={busy}>
            <Check className="mr-1.5 h-4 w-4" />
            {busy ? 'Adding…' : 'Add & put in route'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
