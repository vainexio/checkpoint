import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Poll an endpoint on an interval.
 *
 * Updates here are event-driven — nothing changes until a conductor taps — so
 * polling is honest for Phase 1. Two details keep it from being wasteful or
 * misleading: it stops while the tab is hidden, and it reports `lastUpdated` so
 * the screen can say when it last actually looked.
 */
export function usePolling(fetcher, { intervalMs = 15000, enabled = true, deps = [] } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    let timer = null;

    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState === 'visible') await load({ quiet: true });
      timer = setTimeout(tick, intervalMs);
    };

    load();
    timer = setTimeout(tick, intervalMs);

    // Coming back to the tab should show current information immediately,
    // not whatever was on screen when it was hidden.
    const onVisible = () => {
      if (document.visibilityState === 'visible') load({ quiet: true });
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalMs, ...deps]);

  return { data, error, loading, lastUpdated, refresh: () => load({ quiet: true }), setData };
}

/** A ticking clock, so countdowns keep moving between polls. */
export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
