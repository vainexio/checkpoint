import { useState } from 'react';
import { AlertCircle, Bus, LifeBuoy, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import { useList } from '@/hooks/useList.js';
import { useAuth } from '@/hooks/useAuth.jsx';
import {
  createAdmin,
  createBus,
  createConductor,
  createResetCode,
  deleteAdmin,
  deleteBus,
  deleteConductor,
  listAdmins,
  listBuses,
  listConductors,
} from '@/api/adminApi.js';
import { formatTime } from '@/utils/time.js';
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
  const { user } = useAuth();
  const buses = useList(listBuses);
  const conductors = useList(listConductors);
  const admins = useList(listAdmins);
  const [error, setError] = useState(null);
  const [issued, setIssued] = useState(null);

  const issueCode = async (person) => {
    setError(null);
    try {
      setIssued(await createResetCode(person._id));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err);
    }
  };

  return (
    <>
      <PageHeader
        bare
        icon={Users}
        title="Fleet & crew"
        description="Buses, conductors and the admins who run the system."
      />

      {issued && <ResetCodeNotice issued={issued} onClose={() => setIssued(null)} />}

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {/*
        * Three panels, so three columns once the screen is wide enough.
        *
        * On a two-column grid the third — Admins — dropped to a row of its own
        * and left a card-sized hole beside it, which reads as something having
        * failed to load rather than as a layout. At xl they sit as a row of
        * equals; below that the pair-and-one is close enough to fill the width.
        */}
      <div className="grid items-start gap-4 [&>*]:min-w-0 lg:grid-cols-2 xl:grid-cols-3">
        <BusPanel buses={buses} onError={setError} />
        <StaffPanel
          title="Conductors"
          icon={Users}
          staff={conductors}
          create={createConductor}
          remove={deleteConductor}
          onResetCode={issueCode}
          onError={setError}
        />
        {/* More than one admin is what keeps a forgotten password from
            locking everyone out, so adding one is right here, not a script. */}
        <StaffPanel
          title="Admins"
          icon={ShieldCheck}
          staff={admins}
          create={createAdmin}
          remove={deleteAdmin}
          onResetCode={issueCode}
          onError={setError}
          selfId={user?.id}
        />
      </div>
    </>
  );
}

const DeleteButton = ({ onClick }) => (
  <Button
    variant="ghost"
    size="sm"
    className="text-destructive-strong hover:bg-destructive/10 hover:text-destructive-strong"
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
          <Bus className="h-4 w-4 text-primary-strong" />
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

/**
 * Staff accounts of one role. The same panel serves conductors and admins,
 * because what an operator does with either is the same: add someone with a
 * temporary password, get them back in when they are locked out, remove them.
 */
function StaffPanel({ title, icon: Icon, staff, create, remove, onResetCode, onError, selfId }) {
  const [form, setForm] = useState({ name: '', username: '', password: '' });
  const [busy, setBusy] = useState(false);
  const id = title.toLowerCase();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await create(form);
      setForm({ name: '', username: '', password: '' });
      await staff.reload();
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
          <Icon className="h-4 w-4 text-primary-strong" />
          {title}
        </CardTitle>
        <span className="font-mono text-xs text-muted-foreground">{staff.items.length}</span>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${id}-name`}>Name</Label>
              <Input
                id={`${id}-name`}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-user`}>Username</Label>
              <Input
                id={`${id}-user`}
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                autoCapitalize="none"
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-pass`}>Temporary password (min 8 characters)</Label>
            <Input
              id={`${id}-pass`}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              minLength={8}
              required
            />
            <p className="text-xs text-muted-foreground">
              They will be asked to replace it with their own the first time they sign in.
            </p>
          </div>
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </Button>
        </form>

        <Separator className="my-5" />

        {staff.items.length === 0 ? (
          <div className="rounded-xl border border-dashed py-10 text-center text-muted-foreground">
            No accounts yet.
          </div>
        ) : (
          <Table>
            <TableBody>
              {staff.items.map((person) => (
                <TableRow key={person._id}>
                  <TableCell>
                    <div className="font-semibold">
                      {person.name}
                      {person._id === selfId && (
                        <span className="ml-2 text-xs font-medium text-muted-foreground">(you)</span>
                      )}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {person.username}
                      {person.mustChangePassword && (
                        <span className="ml-2 font-sans">· still on a temporary password</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {person._id !== selfId && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mr-1.5"
                        onClick={() => onResetCode(person)}
                        title="Give them a one-time code to set a new password"
                      >
                        <LifeBuoy className="mr-1.5 h-3.5 w-3.5" />
                        Reset code
                      </Button>
                    )}
                    {person._id !== selfId && (
                      <DeleteButton
                        onClick={async () => {
                          if (!window.confirm(`Remove ${person.name}'s account?`)) return;
                          try {
                            await remove(person._id);
                            await staff.reload();
                          } catch (err) {
                            onError(err);
                          }
                        }}
                      />
                    )}
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

/**
 * The code, shown once. It is never stored in readable form, so if this is
 * closed before it is passed on, the answer is simply to issue another.
 */
function ResetCodeNotice({ issued, onClose }) {
  return (
    <div className="mb-4 rounded-xl border-2 border-primary/40 bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold">
            Reset code for {issued.name} ({issued.username})
          </div>
          <div className="mt-2 font-mono text-[28px] font-bold tracking-[0.18em]">{issued.code}</div>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Works once, until {formatTime(issued.expiresAt)}. Tell them to open <b>Sign in</b> →{' '}
            <b>Forgot your password?</b> and enter it with their username. You will not see the
            password they choose, and this code is not shown again.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Dismiss">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
