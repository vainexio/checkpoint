import { useState } from 'react';
import { AlertCircle, Plus, Route as RouteIcon, Trash2, X } from 'lucide-react';
import { useList } from '@/hooks/useList.js';
import { createRoute, deleteRoute, listCheckpoints, listRoutes } from '@/api/adminApi.js';
import { PageHeader } from '@/components/layout/AppLayout.jsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { cn } from '@/lib/utils.ts';

const emptyRow = () => ({ checkpoint: '', baselineMinutesFromPrevious: '' });
const asHours = (m) => `${Math.floor(m / 60)}h ${m % 60}m`;

/**
 * The route builder — the "set once, run every trip" step from the pitch.
 *
 * Baselines are entered per segment because that is how an operator actually
 * knows a route: how long Balintawak to Tarlac usually takes, not what time a
 * bus reaches Tarlac. The running total is shown as you type, since that is the
 * number an operator can sanity-check against experience.
 */
export default function AdminRoutesPage() {
  const routes = useList(listRoutes);
  const checkpoints = useList(listCheckpoints);

  const [name, setName] = useState('');
  const [rows, setRows] = useState([emptyRow(), emptyRow()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const total = rows.reduce((sum, r) => sum + (Number(r.baselineMinutesFromPrevious) || 0), 0);

  const setRow = (index, patch) =>
    setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);

    const filled = rows.filter((r) => r.checkpoint);
    if (filled.length < 2) {
      setError(new Error('A route needs at least an origin and a destination.'));
      return;
    }

    setBusy(true);
    try {
      await createRoute({
        name,
        checkpoints: filled.map((r, i) => ({
          checkpoint: r.checkpoint,
          // The origin has nothing before it, so its baseline is always zero.
          baselineMinutesFromPrevious: i === 0 ? 0 : Number(r.baselineMinutesFromPrevious) || 0,
        })),
      });
      setName('');
      setRows([emptyRow(), emptyRow()]);
      await routes.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    try {
      await deleteRoute(id);
      await routes.reload();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <>
      <PageHeader
        icon={RouteIcon}
        title="Routes"
        description="An ordered chain of checkpoints with the usual travel time between each. This baseline is what every trip on the route is measured against."
      />

      {(error || routes.error) && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{(error ?? routes.error).message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>New route</CardTitle>
          {total > 0 && (
            <span className="font-mono text-xs text-muted-foreground">
              {asHours(total)} end to end
            </span>
          )}
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-5">
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
              <Label>Checkpoints, in order</Label>
              <div className="space-y-2">
                {rows.map((row, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-[24px_1fr_auto_36px] items-center gap-3"
                  >
                    <span className="text-center font-mono text-xs text-muted-foreground">
                      {index + 1}
                    </span>

                    <Select
                      value={row.checkpoint}
                      onValueChange={(value) => setRow(index, { checkpoint: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a checkpoint…" />
                      </SelectTrigger>
                      <SelectContent>
                        {checkpoints.items.map((cp) => (
                          <SelectItem key={cp._id} value={cp._id}>
                            {cp.name}
                            {cp.type === 'landmark' ? ' (landmark)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {index === 0 ? (
                      <span className="whitespace-nowrap text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                        origin
                      </span>
                    ) : (
                      <div className="flex items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
                        <Input
                          type="number"
                          min="0"
                          className="w-20"
                          value={row.baselineMinutesFromPrevious}
                          onChange={(e) =>
                            setRow(index, { baselineMinutesFromPrevious: e.target.value })
                          }
                          placeholder="0"
                        />
                        <span className="hidden sm:inline">min from previous</span>
                        <span className="sm:hidden">min</span>
                      </div>
                    )}

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      onClick={() => setRows(rows.filter((_, i) => i !== index))}
                      disabled={rows.length <= 2}
                      aria-label={`Remove checkpoint ${index + 1}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRows([...rows, emptyRow()])}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add checkpoint
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Create route'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Existing routes</CardTitle>
          <span className="font-mono text-xs text-muted-foreground">{routes.items.length}</span>
        </CardHeader>
        <CardContent className="space-y-3">
          {routes.loading && <div className="py-10 text-center text-muted-foreground">Loading…</div>}
          {!routes.loading && routes.items.length === 0 && (
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
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => remove(route._id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
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
    </>
  );
}
