import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { cn } from '@/lib/utils.ts';

/**
 * A map of fixed places — nothing on it moves.
 *
 * Every pin here is a checkpoint an operator encoded once: a terminal, a stop,
 * a toll exit. No bus position is ever plotted, because the system does not
 * know one; it knows which checkpoints have been confirmed. The map answers
 * "where are the stops, and which one is near me", not "where is the bus".
 *
 * OpenStreetMap tiles, so there is no API key, no billing account, and nothing
 * to expire.
 */

const PH_CENTER = [15.5, 120.9];

// Leaflet's default marker images assume a bundler-less setup and 404 under
// Vite, so every marker is drawn as inline SVG instead. It also lets a station,
// a landmark and "you" look meaningfully different.
const pin = (fill, stroke, glyph) =>
  L.divIcon({
    className: '',
    html: `<svg width="28" height="36" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 35C14 35 26 22.5 26 14A12 12 0 1 0 2 14c0 8.5 12 21 12 21z"
            fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      <circle cx="14" cy="14" r="5.5" fill="#fff"/>
      ${glyph ?? ''}
    </svg>`,
    iconSize: [28, 36],
    iconAnchor: [14, 35],
    popupAnchor: [0, -32],
  });

/**
 * Three marker designs, because the three kinds of point mean different things
 * to someone reading the map:
 *
 *   terminal — where a route starts or ends. Largest, with a filled centre.
 *   stop     — you can board here. Standard pin.
 *   landmark — timing point only, no boarding. Grey and hollow, so it never
 *              looks like somewhere to wait.
 */
const ICONS = {
  terminal: L.divIcon({
    className: '',
    html: `<svg width="34" height="42" viewBox="0 0 34 42" xmlns="http://www.w3.org/2000/svg">
      <path d="M17 41C17 41 31 26 31 17A14 14 0 1 0 3 17c0 9 14 24 14 24z"
            fill="#1d4ed8" stroke="#1e3a8a" stroke-width="2"/>
      <circle cx="17" cy="17" r="7" fill="#fff"/>
      <circle cx="17" cy="17" r="3.5" fill="#1d4ed8"/>
    </svg>`,
    iconSize: [34, 42],
    iconAnchor: [17, 41],
    popupAnchor: [0, -38],
  }),
  station: pin('#3b82f6', '#2563eb'),
  landmark: L.divIcon({
    className: '',
    html: `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="6" fill="#fff" stroke="#94a3b8" stroke-width="2.5"
              stroke-dasharray="3 2"/>
    </svg>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -12],
  }),
};

const youAreHere = L.divIcon({
  className: '',
  html: `<span style="display:block;width:18px;height:18px;border-radius:50%;
    background:#16a34a;border:3px solid #fff;box-shadow:0 0 0 3px rgba(22,163,74,.35)"></span>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const iconFor = (cp) =>
  cp.type === 'landmark' ? ICONS.landmark : cp.isTerminal ? ICONS.terminal : ICONS.station;

/*
 * There is deliberately no route line.
 *
 * A polyline between checkpoints draws a straight line where the road bends,
 * so it would show buses cutting across Laguna de Bay and through mountains.
 * Drawing the true road geometry would mean a routing call per route and a
 * quota to manage, for decoration. The pins are what carry the information.
 */

/**
 * Frame everything once, then leave the map alone.
 *
 * Refitting whenever the points change sounds helpful and is maddening: the
 * caller rebuilds its array every render, so the map snapped back to the whole
 * country the instant you zoomed in to place a pin. The view belongs to the
 * person using it — it is re-framed on first load, and after that only when the
 * caller explicitly asks by changing `fitKey`.
 */
function FitTo({ points, fitKey = null }) {
  const map = useMap();
  const framedOnce = useRef(false);

  useEffect(() => {
    if (!points.length) return;
    if (framedOnce.current && fitKey === null) return;

    if (points.length === 1) map.setView(points[0], 13);
    else map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 13 });

    framedOnce.current = true;
    // points is deliberately not a dependency — only its arrival and an
    // explicit fitKey should move the map.
  }, [map, fitKey, points.length]);

  return null;
}

/**
 * Pan to one place on request — a search result, say — without disturbing the
 * zoom the person has chosen.
 */
function FocusOn({ point, zoom = 15 }) {
  const map = useMap();
  const key = point ? `${point.lat},${point.lng}` : null;

  useEffect(() => {
    if (point) map.setView([point.lat, point.lng], Math.max(map.getZoom(), zoom));
    // Keyed by coordinate so re-renders with the same point do nothing.
  }, [map, key]);

  return null;
}

/** Let the admin drop a pin by clicking the map. */
function ClickToPlace({ onPick }) {
  const map = useMap();

  useEffect(() => {
    if (!onPick) return undefined;
    const handler = (e) => onPick({ lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) });
    map.on('click', handler);
    return () => map.off('click', handler);
  }, [map, onPick]);

  return null;
}

export function CheckpointMap({
  checkpoints = [],
  routePath = [],
  you = null,
  selectedId = null,
  onSelect = null,
  onPick = null,
  draft = null,
  focusOn = null,
  fitKey = null,
  className,
  height = 340,
}) {
  const placed = useMemo(() => checkpoints.filter((c) => c.location), [checkpoints]);

  const fitPoints = useMemo(() => {
    const pts = placed.map((c) => [c.location.lat, c.location.lng]);
    if (you) pts.push([you.lat, you.lng]);
    // The draft pin is deliberately excluded: you just clicked there, so it is
    // already on screen, and including it would re-frame the map on every click.
    return pts;
  }, [placed, you]);

  return (
    <div
      className={cn('overflow-hidden rounded-xl border border-border', className)}
      style={{ height }}
    >
      <MapContainer
        center={PH_CENTER}
        zoom={7}
        scrollWheelZoom={false}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <FitTo points={fitPoints} fitKey={fitKey} />
        <FocusOn point={focusOn} />
        <ClickToPlace onPick={onPick} />

        {placed.map((cp) => (
          <Marker
            key={cp.id ?? cp._id}
            position={[cp.location.lat, cp.location.lng]}
            icon={iconFor(cp)}
            opacity={selectedId && selectedId !== (cp.id ?? cp._id) ? 0.55 : 1}
            eventHandlers={onSelect ? { click: () => onSelect(cp) } : undefined}
          >
            <Popup>
              <strong>{cp.name}</strong>
              {cp.area && <div>{cp.area}</div>}
              <div style={{ color: '#64748b' }}>
                {cp.type === 'landmark'
                  ? 'Timing point — nobody boards'
                  : cp.isTerminal
                    ? 'Terminal'
                    : 'Pick-up & drop-off point'}
                {cp.distanceKm != null && ` · ${cp.distanceKm} km away`}
              </div>
            </Popup>
          </Marker>
        ))}

        {draft && <Marker position={[draft.lat, draft.lng]} icon={ICONS.station} />}
        {you && (
          <>
            {/*
              * The dot is where the device thinks you are; the circle is how
              * much it is guessing. On a laptop that circle is often kilometres
              * wide, and drawing it is the difference between "the map is
              * wrong" and "the fix is coarse".
              */}
            {you.accuracyM > 100 && (
              <Circle
                center={[you.lat, you.lng]}
                radius={you.accuracyM}
                pathOptions={{ color: '#2563eb', weight: 1, fillOpacity: 0.08 }}
              />
            )}
            <Marker position={[you.lat, you.lng]} icon={youAreHere}>
              <Popup>
                You are here
                {you.accuracyM ? (
                  <>
                    <br />
                    accurate to about{' '}
                    {you.accuracyM >= 1000
                      ? `${Math.round(you.accuracyM / 1000)} km`
                      : `${Math.round(you.accuracyM)} m`}
                  </>
                ) : null}
              </Popup>
            </Marker>
          </>
        )}
      </MapContainer>
    </div>
  );
}
