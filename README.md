# CHECKPOINT

A live bus arrival tracker for Philippine provincial routes that works **without GPS**.

Provincial routes run through mountain and rural stretches where continuous GPS tracking
silently breaks, and LTFRB dropped its GPS mandate in the 2026 Service Contracting Program
after operators flagged the hardware cost. CHECKPOINT takes the other approach: location
comes from **confirmed checkpoints**, the way pre-GPS railway control and courier
scan-at-each-stop tracking work.

A conductor taps a button when the bus passes a known point. The system compares that
against the route's baseline travel time, derives how early or late the bus is running, and
projects that variance forward onto every remaining stop.

There is no GPS or device geolocation anywhere in this system, by design.

## The three experiences

| | Auth | What it is |
|---|---|---|
| **Guest** | None | Dark arrivals board, browsable by station. Every bus inbound, soonest first. |
| **Conductor** | JWT | Their own trips and four taps. Mobile-first, works offline. |
| **Admin** | JWT | Routes, checkpoints, buses, conductor accounts, trip scheduling, live dashboard. |

## Quick start

```bash
cd server && npm install && cp .env.example .env   # fill in MONGODB_URI and JWT_SECRET
npm run seed                                        # Cubao – Baguio demo route + accounts
npm start                                           # API on :4000
```

```bash
cd client && npm install && cp .env.example .env
npm run dev                                         # UI on :5173
```

Demo accounts created by the seed (change them before this touches anything real):

- Admin — `admin` / `checkpoint123`
- Conductors — `rey` / `checkpoint123`, `marlon` / `checkpoint123`
- Guests need no account at all.

## How the ETA works

All of it lives in [`server/services/etaEngine.js`](server/services/etaEngine.js) as pure
functions — no Mongoose, no Express, no clock reads except the `now` you pass in. That keeps
it unit-testable without a database, and leaves a clean seam where a traffic API could later
replace the static baseline lookup.

**On departure**, each checkpoint is projected at `actualDeparture + baseline so far`.

**On each confirmed checkpoint**, variance is recomputed *from the departure time*, never
accumulated segment by segment:

```
variance = (reportedAt − actualDeparture) − (baseline from origin through here)
```

Then every checkpoint still ahead is re-projected with that variance applied. Computing it
from scratch each time means rounding never compounds over a long multi-checkpoint trip, and
a bus that loses 15 minutes then makes up 10 reports +5, not +15.

**A "delayed" report changes no arithmetic.** It isn't anchored to a measured distance, so it
rides alongside the ETA as context ("conductor reported heavy traffic near Balintawak,
2:46 PM") rather than feeding into it.

**Trip state is a pure replay of the log stream**, sorted by `reportedAt`. That is what makes
offline sync work: a batch of taps that reaches the server in the wrong order, hours late,
still settles on exactly the state it would have reached live.

### Staleness matters as much as the number

An ETA that stopped updating an hour ago is worse than no ETA, because it looks just as
confident. So staleness is derived on **every read**, never stored — a trip goes stale by the
passage of time alone, with no write to trigger an update:

```
staleAfter = lastConfirmedAt + segmentBaseline + (50% of that segment's baseline)
```

The grace scales with the segment, so a 20-minute urban hop is flagged sooner than an
80-minute rural one. When a trip is stale the board greys the number, labels it "estimate
only", and says how long it has been since anyone confirmed anything.

## Offline queueing

Connectivity on provincial routes is unreliable, so a tap must never fail for want of signal.

1. Every tap is stamped with a **client-generated `reportedAt`** at the moment of the tap.
2. It is written to `localStorage` **before** any request is attempted.
3. Sending is best-effort. Failures keep the queue; the conductor sees "3 updates waiting to
   send", not an error.
4. On reconnect the queue drains to `POST /api/conductor/trips/:id/checkpoint-logs/sync`,
   which processes in `reportedAt` order regardless of arrival order.
5. Each log carries a client-generated `clientLogId` with a unique index, so a phone that
   retries cannot double-count a checkpoint and corrupt the variance.

The ETA engine reads `reportedAt` only. When a log actually reached the server is recorded as
`syncedAt` for diagnostics and never enters the arithmetic.

## Design notes

A trip **freezes its route's checkpoints and baselines onto itself** when it is created.
Editing a route later changes what future trips inherit — it cannot retroactively rewrite the
yardstick a bus already in motion is being measured against, and it leaves completed trips'
actual-vs-baseline records meaningful as recalibration input later.

Two grounds, one product: the public board is dark because it is a *display* surface read
across a terminal hall; the conductor and admin apps are light because they are *working*
surfaces used in daylight and across long shifts. IBM Plex Sans carries the language, IBM
Plex Mono carries every time and number, because tabular figures are what keep a departure
board legible at a glance.

All timestamps are stored in UTC and displayed in `Asia/Manila` explicitly, never by trusting
the viewer's device clock.

## Tests

```bash
cd server && npm test
```

29 tests: the engine's arithmetic (variance, re-projection, skipped checkpoints, out-of-order
replay, staleness thresholds) plus API integration against an in-memory MongoDB covering
auth separation, the frozen plan, offline sync, and the public board.

## Project layout

```
server/
  models/       Checkpoint, Route, Bus, User, Trip, CheckpointLog
  services/     etaEngine.js (pure) · tripService.js (persistence bridge)
  controllers/  auth · admin · conductor · public
  middleware/   JWT auth, role checks, error handling
  seed.js       Cubao – Baguio demo data
client/
  src/pages/    guest/ · conductor/ · admin/
  src/hooks/    usePolling · useOfflineQueue · useAuth
  src/api/      one module per audience
  src/styles/   design tokens and shared UI
```

## Not built yet (deliberately)

GPS or geolocation in any form · live traffic API integration · multi-operator tenancy ·
automatic baseline recalibration from historical trips (the data is logged, the job is not
built) · payments and the paid operator-analytics tier · push notifications and SMS fallback.
