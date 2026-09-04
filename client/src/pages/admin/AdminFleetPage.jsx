import { useState } from 'react';
import { AlertCircle, Bus, Trash2, Users } from 'lucide-react';
import { useList } from '@/hooks/useList.js';
import {
  createBus,
  createConductor,
  deleteBus,
  deleteConductor,
  listBuses,
  listConductors,
} from '@/api/adminApi.js';
import { PageHeader } from '@/components/layout/AppLayout.jsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Separator } from '@/components/ui/separator.tsx';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table.tsx';

/** Buses and the people on them — the two things a trip needs assigned to it. */
export default function AdminFleetPage() {
  const buses = useList(listBuses);
  const conductors = useList(listConductors);
  const [error, setError] = useState(null);

  return (
    <>
      <PageHeader
        bare
        icon={Users}
        title="Fleet & crew"
        description="Buses and conductor accounts available for scheduling."
      />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <BusPanel buses={buses} onError={setError} />
        <ConductorPanel conductors={conductors} onError={setError} />
      </div>
    </>
  );
}

const DeleteButton = ({ onClick }) => (
  <Button
    variant="ghost"
    size="sm"
    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
    onClick={onClick}
  >
    <Trash2 className="h-3.5 w-3.5" />
  </Button>
);

function BusPanel({ buses, onError }) {
  const [form, setForm] = useState({ plateNumber: '', operatorName: '' });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await createBus(form);
      setForm({ plateNumber: '', operatorName: '' });
      await buses.reload();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Bus className="h-4 w-4 text-primary" />
          Buses
        </CardTitle>
        <span className="font-mono text-xs text-muted-foreground">{buses.items.length}</span>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="plate">Plate number</Label>
              <Input
                id="plate"
                value={form.plateNumber}
                onChange={(e) => setForm({ ...form, plateNumber: e.target.value })}
                placeholder="NRT 8821"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="operator">Operator</Label>
              <Input
                id="operator"
                value={form.operatorName}
                onChange={(e) => setForm({ ...form, operatorName: e.target.value })}
                placeholder="Northline Express"
                required
              />
            </div>
          </div>
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? 'Adding…' : 'Add bus'}
          </Button>
        </form>

        <Separator className="my-5" />

        {buses.items.length === 0 ? (
          <div className="rounded-xl border border-dashed py-10 text-center text-muted-foreground">
            No buses yet.
          </div>
        ) : (
          <Table>
            <TableBody>
              {buses.items.map((bus) => (
                <TableRow key={bus._id}>
                  <TableCell className="font-mono font-medium">{bus.plateNumber}</TableCell>
                  <TableCell className="text-muted-foreground">{bus.operatorName}</TableCell>
                  <TableCell className="text-right">
                    <DeleteButton
                      onClick={async () => {
                        try {
                          await deleteBus(bus._id);
                          await buses.reload();
                        } catch (err) {
                          onError(err);
                        }
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function ConductorPanel({ conductors, onError }) {
  const [form, setForm] = useState({ name: '', username: '', password: '' });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await createConductor(form);
      setForm({ name: '', username: '', password: '' });
      await conductors.reload();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          Conductors
        </CardTitle>
        <span className="font-mono text-xs text-muted-foreground">{conductors.items.length}</span>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="c-name">Name</Label>
              <Input
                id="c-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-user">Username</Label>
              <Input
                id="c-user"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                autoCapitalize="none"
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-pass">Temporary password (min 8 characters)</Label>
            <Input
              id="c-pass"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              minLength={8}
              required
            />
          </div>
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </Button>
        </form>

        <Separator className="my-5" />

        {conductors.items.length === 0 ? (
          <div className="rounded-xl border border-dashed py-10 text-center text-muted-foreground">
            No conductor accounts yet.
          </div>
        ) : (
          <Table>
            <TableBody>
              {conductors.items.map((c) => (
                <TableRow key={c._id}>
                  <TableCell>
                    <div className="font-semibold">{c.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{c.username}</div>
                  </TableCell>
                  <TableCell className="text-right">
                    <DeleteButton
                      onClick={async () => {
                        try {
                          await deleteConductor(c._id);
                          await conductors.reload();
                        } catch (err) {
                          onError(err);
                        }
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
