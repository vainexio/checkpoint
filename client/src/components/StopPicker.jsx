import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, MapPin, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input.tsx';
import { cn } from '@/lib/utils.ts';

/**
 * Type-to-find a stop.
 *
 * A plain dropdown works today with fourteen stops and stops working the moment
 * an operator adds a province. It also assumes the passenger knows the official
 * name — "SM Santo Tomas Terminal" when they were going to type "santo tomas" —
 * so the area is searchable too and shown beneath each name.
 */
export function StopPicker({
  stations,
  value,
  onChange,
  placeholder = 'Search a stop',
  extraOption = null,
  id,
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);

  useEffect(() => {
    const away = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? stations.filter(
          (s) =>
            s.name.toLowerCase().includes(q) || (s.area ?? '').toLowerCase().includes(q)
        )
      : stations;
    return pool.slice(0, 8);
  }, [stations, query]);

  const choose = (station) => {
    onChange(station);
    setQuery('');
    setOpen(false);
  };

  const label = value ? value.name : extraOption && value === null ? extraOption.label : '';

  return (
    <div className="relative" ref={boxRef}>
      {value || (extraOption && !open) ? (
        <button
          type="button"
          id={id}
          onClick={() => {
            setOpen(true);
            setActive(0);
          }}
          className={cn(
            'flex h-11 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm',
            'transition-colors hover:border-primary/40 focus:outline-none focus:ring-1 focus:ring-ring'
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0 truncate font-semibold">{label || placeholder}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {value && (
              <span
                role="button"
                tabIndex={-1}
                aria-label="Clear"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                  // Clearing is the start of retyping, not the end of an
                  // interaction — reopen so the input mounts focused.
                  setQuery('');
                  setOpen(true);
                  setActive(0);
                }}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </span>
        </button>
      ) : (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={id}
            key={open ? 'open' : 'closed'}
            autoFocus={open}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, matches.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const pick = matches[active] ?? matches[0];
                if (pick) choose(pick);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
            placeholder={placeholder}
            className="h-11 pl-9"
          />
        </div>
      )}

      {open && (
        // Leaflet stacks its own panes from z-index 400 and its controls at 1000,
        // so anything floating over a map has to clear that outright — a tasteful
        // z-30 loses to the tiles and the list gets sliced off mid-list.
        <div className="absolute z-[1200] mt-1 max-h-[min(60vh,340px)] w-full overflow-y-auto overscroll-contain rounded-lg border border-border bg-background shadow-lg">
          {extraOption && (
            <button
              type="button"
              onClick={() => {
                extraOption.onSelect();
                setOpen(false);
                setQuery('');
              }}
              className="flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left text-sm font-semibold hover:bg-muted"
            >
              {extraOption.icon}
              {extraOption.label}
              {value === null && <Check className="ml-auto h-4 w-4 text-primary" />}
            </button>
          )}

          {matches.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">No stop matched that.</p>
          ) : (
            matches.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(s)}
                className={cn(
                  'flex w-full flex-col items-start px-3 py-2 text-left',
                  i === active && 'bg-muted'
                )}
              >
                <span className="text-sm font-semibold">{s.name}</span>
                {s.area && <span className="text-xs text-muted-foreground">{s.area}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
