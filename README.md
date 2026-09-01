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

**No bus is ever tracked by GPS.** Checkpoints carry coordinates so stops can be shown on a
map and ranked by distance, and so the traffic provider has segment endpoints to ask about —
but a bus's position comes only from a conductor confirming a checkpoint, never from a device.
The map has no moving parts.

## The three experiences

| | Auth | What it is |
|---|---|---|
| **Guest** | None at all | Arrivals board, browsable by station. Every bus inbound, soonest first. |
| **Conductor** | JWT | Their own trips and four taps. Mobile-first, works offline. |
| **Admin** | JWT | Routes, checkpoints, buses, conductor accounts, trip scheduling, live dashboard. |

Staff share **one sign-in** at `/login`. Nobody has to know which of two forms is
"theirs" before typing a password — the account's role decides where they land, and the
role boundary is enforced on every protected route rather than by which page was opened.
Guests never sign in.

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

## Deploying to Render

**One service.** Express serves the API and the built React app together, so there is a single
URL, no CORS, and no pair of services that need to know each other's addresses.

| Field | Value |
|---|---|
| Root Directory | *(leave blank)* |
| Build Command | `npm install --prefix server && npm install --prefix client && npm run build --prefix client` |
| Start Command | `node server/server.js` |
| Health Check Path | `/health` |

Environment variables:

```
NODE_VERSION=20.11.1
MONGODB_URI=...
JWT_SECRET=...
JWT_EXPIRES_IN=12h
TRAFFIC_PROVIDER=tomtom
TRAFFIC_API_KEY=...
```

Don't set `PORT` — Render injects it. Don't set `CLIENT_ORIGIN` or `VITE_API_BASE_URL` — the
client calls a relative `/api`, so neither applies.

`render.yaml` declares all of the above; **New > Blueprint** creates the service from it.

Two things that will otherwise bite:

- **Atlas network access.** Render's free tier has no static outbound IPs, so the cluster must
  allow `0.0.0.0/0` under Network Access or every request fails to connect.
- **Seed once, manually.** Run `npm run seed` locally against the production `MONGODB_URI`.
  It rebuilds the demo trips every run, so it must not be part of the deploy.

On the free plan the service sleeps after ~15 minutes idle and takes ~50s to wake, which looks
like a broken board to anyone opening it cold.

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

### Where a bus is, honestly

A bus does two separate things at a stop where passengers board: it pulls in, and later it
pulls out. Those are opposite instructions for someone standing there — run, or settle in — so
a station is modelled as **two events**, not one:

| Event | Means |
|---|---|
| `passed_checkpoint` | reached this point. At a station: standing there, possibly boarding. |
| `left_checkpoint` | pulled out. Now on the road to the next point. |

A **landmark** is genuinely instantaneous — nobody boards at a toll exit — so it takes one tap
and the bus is immediately "between".

This gives three honest positions, and the UI never shows anything else: `at_stop`, `between`,
`arrived`. The bus marker sits *on* a stop only while it is standing there, and moves onto the
leg the moment the pull-out is reported. A bus at a stop also stays on **that stop's own
board**, ranked first and highlighted — dropping it because the checkpoint is technically
"passed" would hide it from the one person who can still catch it.

Dwell needs no special case in the arithmetic. A leg's baseline already includes the dwell at
the stop it ends on, so the same variance formula measures "how late it is *leaving*", and a
bus that arrives on time then sits for twenty minutes is twenty minutes late immediately —
rather than that only being discovered at the next checkpoint.

### The terminal display

`/display/:stationId` is the wall screen — a different product from the phone board despite
the same data. Nobody touches it: it hangs above a concourse, is read from metres away, and
must work through every bus on its own.

- **Crucial only.** When, which bus, where it has got to, and whether you can board. Everything
  else is dropped.
- **All three things a terminal has to answer**, each labelled: what is *departing* from here,
  what is *arriving*, and what has just *arrived* and is still on the stand. The same trip is a
  departure at its origin and an arrival everywhere else, so the row says which — an "expected
  arrival" for a bus parked at its own starting terminal is simply the wrong sentence. A
  finished bus stays up for 45 minutes, the way an airport board keeps landed flights.
- **Pages rather than scrolls.** A moving board is hard to read and people arrive mid-cycle, so
  it turns the page every 9 seconds, fitting as many rows as the screen actually has.
- **The page is derived from the clock, not advanced by a timer.** A screen like this runs for
  weeks unattended, where an interval can drift, be throttled while backgrounded, or be lost on
  a re-render. Reading the page off the wall clock cannot get stuck.
- `?dark=1` for a dark hall, `&rows=N` to override the fit.

The passenger board is compact for the same reason — plate, route, status, seats, position and
the time. Traffic, delay notes, onward stops and the route strip sit behind "Details".

### Seat availability

The other question a passenger has, after "when": *will I get on?* On a provincial route with
90 minutes to the next bus, knowing **not to wait** is worth as much as the ETA.

Three levels — seats available / filling up / full — chosen because they map to the decision,
not to a count. A conductor can judge "full" in a glance; counting free seats is a different
job, and asking for it is how you get an app nobody uses.

Rules that keep it honest:

- **It rides on a tap already being made.** Leaving a stop carries the reading, so the normal
  case costs no extra action.
- **It is invalidated on reaching the next stop**, never carried forward. That is precisely the
  place it can change: a bus that left Calamba full may empty at Santo Tomas, and a stale
  "full" would make someone give up on a bus they could have caught.
- **It is always attributed** — "as it left Calamba Crossing, 08:14 PM" — never shown as a live
  measurement.
- **"Full" changes the row, not just a badge.** The whole point is telling someone not to wait,
  so those rows carry a banner saying so.
- It touches no arithmetic. Like a delay note, it is information beside the ETA, not an input.

**Limitation worth stating:** this is a conductor's judgement, not a measurement, and is subject
to both error and incentive. Electronic ticketing would give it objectively, which is why
systems that have it do not ask staff.

### Staleness matters as much as the number

An ETA that stopped updating an hour ago is worse than no ETA, because it looks just as
confident. So staleness is derived on **every read**, never stored — a trip goes stale by the
passage of time alone, with no write to trigger an update:

```
staleAfter = lastConfirmedAt + segmentBaseline + (50% of that segment's baseline)
```

The grace scales with the segment, so a 20-minute urban hop is flagged sooner than an
80-minute rural one. When a trip is stale the board greys the number, labels it "estimate
estimate, and says how long it has been since anyone confirmed anything.

## Live traffic

Baselines say what a leg *usually* takes. Traffic says what it is taking now.
[`services/trafficProvider.js`](server/services/trafficProvider.js) turns the second into a
per-segment adjustment the engine applies to the road still ahead.

Checkpoints are what make this affordable. A GPS system has no idea which stretch of highway
matters, so it polls everything; we know each bus's last confirmed checkpoint, so we ask about
the one or two segments it is about to drive — **once per segment**, however many buses are on
it, cached for five minutes, and never on the request path.

The split that matters:

- **Variance is a measurement** of what already happened, and no traffic feed revises it.
- **Traffic only moves projections** for segments ahead of the last confirmed checkpoint.
- Congestion we already know about also **widens the staleness window**, so a bus stuck in a
  reported jam is not accused of having gone silent.

Set `TRAFFIC_API_KEY` in `server/.env` to enable it ([TomTom](https://developer.tomtom.com)
has a free tier with no card). With no key the provider is inert and ETAs use pure baselines —
same behaviour as before traffic existed, and every test covers both paths.

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

### Undo

A wrong button on a moving bus is a matter of when, not if, so every tap can be taken back for
five minutes. If the update is still queued it never left the phone and is simply dropped; if
it already synced, the server deletes that log and replays the trip without it.

This is only safe because trip state *is* the replay — there is no accumulated state to unwind,
so a trip can never be left half-corrected. After five minutes undo is refused, since by then
passengers have been reading the number.

## Design notes

A trip **freezes its route's checkpoints and baselines onto itself** when it is created.
Editing a route later changes what future trips inherit — it cannot retroactively rewrite the
yardstick a bus already in motion is being measured against, and it leaves completed trips'
actual-vs-baseline records meaningful as recalibration input later.

The frontend uses the **SCOUT design system** — Tailwind v4 with SCOUT's token set, its
shadcn/ui (new-york) primitives copied in unmodified, Plus Jakarta Sans and JetBrains Mono,
and its `glass-panel` navbar, `bg-blobs` ambient background and `PageHeader` pattern.

All three experiences share one light palette, so a passenger checking a bus and a dispatcher
checking the same bus recognise it as the same product. Every time and number is set in
JetBrains Mono with tabular figures, because that is what keeps an arrivals board legible at a
glance and stops the ETA twitching as digits change.

The public board is written for someone who has never seen it before: the arrival time is
labelled ("Expected arrival" vs "Scheduled arrival"), status is in plain words
("Running late by 8 min", "No recent update", "Not yet departed"), and the header says
outright that times update when a conductor confirms a checkpoint.

All timestamps are stored in UTC and displayed in `Asia/Manila` explicitly, never by trusting
the viewer's device clock.

## Tests

```bash
cd server && npm test
```

50 tests: the engine's arithmetic (variance, re-projection, skipped checkpoints, out-of-order
replay, staleness thresholds, and traffic applying forward-only without touching a measured
variance) plus API integration against an in-memory MongoDB covering the shared login and its
role boundary, the frozen plan, offline sync, undo and its limits, at-stop versus on-the-road position, and the public board.

## Project layout

```
server/
  models/       Checkpoint, Route, Bus, User, Trip, CheckpointLog
  services/     etaEngine.js (pure) · tripService.js (persistence bridge)
                trafficProvider.js (pluggable) · trafficRefresher.js (cache warmer)
  controllers/  auth · admin · conductor · public
  middleware/   JWT auth, role checks, error handling
  seed.js       Cubao – Baguio demo data
client/
  src/pages/          guest/ · conductor/ · admin/
  src/components/ui/  shadcn primitives, copied from SCOUT
  src/components/     StatusBadge · StaleNotice · Timeline · JourneyStrip
                      CheckpointMap (Leaflet/OSM) · layout/AppLayout
  src/hooks/          usePolling · useOfflineQueue · useAuth
  src/api/            one module per audience
  src/index.css       SCOUT design tokens
```

## Not built yet (deliberately)

GPS tracking of vehicles in any form · multi-operator tenancy · automatic baseline
recalibration from historical trips (the data is logged, the job is not built) · payments and
the paid operator-analytics tier · push notifications and SMS fallback.
