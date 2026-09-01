import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet';
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

const ICONS = {
  terminal: pin('#2563eb', '#1d4ed8', '<circle cx="14" cy="14" r="2.5" fill="#1d4ed8"/>'),
  station: pin('#2563eb', '#1d4ed8'),
  landmark: pin('#94a3b8', '#64748b'),
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

/** Keep the viewport on whatever is worth looking at right now. */
function FitTo({ points }) {
  const map = useMap();

  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView(points[0], 13);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 13 });
  }, [map, points]);

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
  className,
  height = 340,
}) {
  const placed = useMemo(() => checkpoints.filter((c) => c.location), [checkpoints]);

  const linePoints = useMemo(
    () => routePath.filter((c) => c.location).map((c) => [c.location.lat, c.location.lng]),
    [routePath]
  );

  const fitPoints = useMemo(() => {
    const pts = placed.map((c) => [c.location.lat, c.location.lng]);
    if (you) pts.push([you.lat, you.lng]);
    if (draft) pts.push([draft.lat, draft.lng]);
    return pts;
  }, [placed, you, draft]);

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

        <FitTo points={fitPoints} />
        <ClickToPlace onPick={onPick} />

        {linePoints.length > 1 && (
          <Polyline positions={linePoints} pathOptions={{ color: '#2563eb', weight: 4, opacity: 0.7 }} />
        )}

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
                {cp.type === 'landmark' ? 'Timing point — no boarding' : 'Stop'}
                {cp.distanceKm != null && ` · ${cp.distanceKm} km away`}
              </div>
            </Popup>
          </Marker>
        ))}

        {draft && <Marker position={[draft.lat, draft.lng]} icon={ICONS.station} />}
        {you && (
          <Marker position={[you.lat, you.lng]} icon={youAreHere}>
            <Popup>You are here</Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
