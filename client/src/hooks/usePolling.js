import { useCallback, useEffect, useRef, useState } from 'react';
import { readSnapshot, writeSnapshot } from '@/utils/snapshot.js';

/**
 * Poll an endpoint on an interval.
 *
 * Updates here are event-driven — nothing changes until a conductor taps — so
 * polling is honest for Phase 1. Two details keep it from being wasteful or
 * misleading: it stops while the tab is hidden, and it reports `lastUpdated` so
 * the screen can say when it last actually looked.
 */
export function usePolling(
  fetcher,
  { intervalMs = 15000, enabled = true, deps = [], cacheKey = null } = {}
) {
  /**
   * With a cacheKey, the last good answer is kept on the device and shown at
   * once on the next visit — including one with no signal at all. `savedAt`
   * says how old it is while it is standing in for a live answer, and goes
   * null the moment a live one arrives.
   */
  const [data, setDataState] = useState(() => readSnapshot(cacheKey)?.data ?? null);
  const [savedAt, setSavedAt] = useState(() => readSnapshot(cacheKey)?.savedAt ?? null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const cacheKeyRef = useRef(cacheKey);
  cacheKeyRef.current = cacheKey;

  // Local changes (an optimistic tap, a synced queue) are the newest truth
  // there is, so they are kept too.
  const setData = useCallback((next) => {
    setDataState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      if (value) writeSnapshot(cacheKeyRef.current, value);
      return value;
    });
  }, []);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const result = await fetcherRef.current();
      setDataState(result);
      writeSnapshot(cacheKeyRef.current, result);
      setSavedAt(null);
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

    // A different thing to show (another trip, another account): start from
    // its own snapshot, not the previous one's data.
    if (cacheKey) {
      const snapshot = readSnapshot(cacheKey);
      setDataState(snapshot?.data ?? null);
      setSavedAt(snapshot?.savedAt ?? null);
    }

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
  }, [enabled, intervalMs, cacheKey, ...deps]);

  return {
    data,
    error,
    loading,
    lastUpdated,
    savedAt,
    refresh: () => load({ quiet: true }),
    setData,
  };
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
