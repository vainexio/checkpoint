/**
 * A bus, drawn once, in side view.
 *
 * It exists because the previous approach made the header panel itself the
 * vehicle, which meant the bus took whatever shape the layout handed it:
 * six-to-one and stretched on a wide screen, portrait and luggage-shaped on a
 * phone. A drawing with a viewBox keeps its proportions at every size, so this
 * is the same bus at 180px as at 320px.
 *
 * Everything is drawn in currentColor at varying opacity, so it takes the tone
 * of whatever it is placed on rather than carrying its own palette.
 */
export function BusSide({ className }) {
  return (
    <svg
      viewBox="0 0 240 76"
      className={className}
      fill="none"
      role="img"
      aria-label="Side view of a bus"
    >
      {/* Body */}
      <rect x="3" y="4" width="234" height="52" rx="7" fill="currentColor" opacity="0.16" />

      {/* Saloon windows */}
      {[16, 50, 84, 118].map((x) => (
        <g key={x}>
          <rect x={x} y="11" width="28" height="19" rx="3" fill="currentColor" opacity="0.3" />
          {/* the light along the top of the glass */}
          <rect x={x} y="11" width="28" height="6" rx="3" fill="currentColor" opacity="0.14" />
          {/* the sliding pane's vertical bar */}
          <rect x={x + 18} y="12" width="1" height="17" fill="currentColor" opacity="0.18" />
        </g>
      ))}

      {/* Boarding door: full height of the body, glazed upper half */}
      <rect x="152" y="6" width="20" height="48" rx="3" fill="currentColor" opacity="0.22" />
      <rect x="155" y="11" width="14" height="19" rx="2.5" fill="currentColor" opacity="0.26" />
      <rect x="161.5" y="8" width="1" height="44" fill="currentColor" opacity="0.2" />
      <rect x="157" y="38" width="8" height="1.6" rx="0.8" fill="currentColor" opacity="0.3" />

      {/* Windscreen, raked at the nose */}
      <path
        d="M180 11h38a5 5 0 0 1 5 5v14h-43z"
        fill="currentColor"
        opacity="0.34"
      />
      <path d="M180 11h38a5 5 0 0 1 5 5v2h-43z" fill="currentColor" opacity="0.16" />

      {/* Livery stripe along the flank */}
      <rect x="3" y="40" width="234" height="4" fill="currentColor" opacity="0.12" />

      {/* Lamps: red at the tail, warm at the nose */}
      <rect x="7" y="47" width="9" height="5" rx="1.5" fill="#D9534F" opacity="0.85" />
      <rect x="222" y="47" width="11" height="5" rx="1.5" fill="#F0B429" opacity="0.9" />

      {/* Wheels */}
      {[58, 192].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="58" r="13" fill="#171D1B" />
          <circle cx={cx} cy="58" r="5" fill="currentColor" opacity="0.55" />
        </g>
      ))}
    </svg>
  );
}
