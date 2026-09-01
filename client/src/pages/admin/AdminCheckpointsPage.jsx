import { useState } from 'react';
import { AlertCircle, MapPin, Trash2 } from 'lucide-react';
import { useList } from '@/hooks/useList.js';
import { createCheckpoint, deleteCheckpoint, listCheckpoints } from '@/api/adminApi.js';
import { PageHeader } from '@/components/layout/AppLayout.jsx';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table.tsx';

/**
 * Checkpoints are the vocabulary the whole system is built from. Stations get a
 * public board; landmarks exist purely to take a timing reading, which is why
 * the distinction is spelled out here rather than left as a dropdown label.
 */
export default function AdminCheckpointsPage() {
  const { items, error, loading, reload, setError } = useList(listCheckpoints);
  const [form, setForm] = useState({ name: '', type: 'station', isTerminal: false });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await createCheckpoint(form);
      setForm({ name: '', type: 'station', isTerminal: false });
      await reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    try {
      await deleteCheckpoint(id);
      await reload();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <>
      <PageHeader
        icon={MapPin}
        title="Checkpoints"
        description="The points a conductor can confirm. Encoded once, reused by every route that passes them."
      />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Add a checkpoint</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cp-name">Name</Label>
                <Input
                  id="cp-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Balintawak"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={form.type}
                  onValueChange={(value) => setForm({ ...form, type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="station">Station — gets a public board</SelectItem>
                    <SelectItem value="landmark">Landmark — timing point only</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {form.type === 'station'
                    ? 'Passengers can board here, and it gets its own arrivals board.'
                    : 'Used only to take a timing reading. No public board.'}
                </p>
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
                {busy ? 'Adding…' : 'Add checkpoint'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>All checkpoints</CardTitle>
            <span className="font-mono text-xs text-muted-foreground">{items.length}</span>
          </CardHeader>
          <CardContent>
            {loading && <div className="py-10 text-center text-muted-foreground">Loading…</div>}

            {!loading && items.length === 0 && (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
                No checkpoints yet. Add the first one.
              </div>
            )}

            {items.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((cp) => (
                    <TableRow key={cp._id}>
                      <TableCell className="font-semibold">
                        {cp.name}
                        {cp.isTerminal && (
                          <Badge variant="outline" className="ml-2 text-[10px] uppercase">
                            Terminal
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={cp.type === 'station' ? 'secondary' : 'muted'}>
                          {cp.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => remove(cp._id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
