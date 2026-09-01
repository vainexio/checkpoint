import { useCallback, useEffect, useRef, useState } from 'react';
import { syncLogs, undoLog } from '../api/conductorApi.js';

/**
 * The conductor's write-ahead log.
 *
 * A tap must never fail for want of signal. So every tap is written to
 * localStorage first and only then sent — if the request fails, or the phone is
 * somewhere on the TPLEX with no bars at all, the update is already safely
 * recorded and will go out the moment a connection returns.
 *
 * The timestamp is stamped here, at the moment of the tap. That is what the ETA
 * engine measures against; when the log finally reaches the server hours later
 * is irrelevant to the arithmetic.
 */

const keyFor = (tripId) => `checkpoint.queue.${tripId}`;

const newId = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return `log-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

const readQueue = (tripId) => {
  try {
    const raw = localStorage.getItem(keyFor(tripId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const writeQueue = (tripId, queue) => {
  try {
    if (queue.length) localStorage.setItem(keyFor(tripId), JSON.stringify(queue));
    else localStorage.removeItem(keyFor(tripId));
  } catch {
    /* storage unavailable: the queue lives in memory for this session only */
  }
};

export function useOfflineQueue(tripId, { onSynced } = {}) {
  const [queue, setQueue] = useState(() => (tripId ? readQueue(tripId) : []));
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastError, setLastError] = useState(null);

  const queueRef = useRef(queue);
  queueRef.current = queue;
  const syncingRef = useRef(false);
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;

  useEffect(() => {
    if (tripId) setQueue(readQueue(tripId));
  }, [tripId]);

  const persist = useCallback(
    (next) => {
      setQueue(next);
      queueRef.current = next;
      writeQueue(tripId, next);
    },
    [tripId]
  );

  const flush = useCallback(async () => {
    if (!tripId || syncingRef.current) return;

    const pending = queueRef.current;
    if (!pending.length) return;

    syncingRef.current = true;
    setIsSyncing(true);
    try {
      const res = await syncLogs(tripId, pending);
      // Clear only what this round actually sent — a tap made mid-flight stays
      // queued rather than being dropped on the floor.
      const sent = new Set(res.syncedClientLogIds ?? pending.map((l) => l.clientLogId));
      persist(queueRef.current.filter((l) => !sent.has(l.clientLogId)));
      setLastError(null);
      onSyncedRef.current?.(res.trip);
    } catch (err) {
      // Keep the queue. A failed sync is the expected case out here, not an
      // error state the conductor needs to do anything about.
      setLastError(err);
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
  }, [tripId, persist]);

  const enqueue = useCallback(
    (entry) => {
      const log = {
        ...entry,
        clientLogId: newId(),
        reportedAt: new Date().toISOString(),
      };
      persist([...queueRef.current, log]);
      // Fire and forget: the tap is already durable, so the send is best-effort.
      flush();
      return log;
    },
    [persist, flush]
  );

  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      flush();
    };
    const goOffline = () => setIsOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    // Browsers lie about `navigator.onLine` often enough that a slow retry is
    // worth having: a phone can report "online" on a bar of signal that cannot
    // actually complete a request.
    const retry = setInterval(() => {
      if (queueRef.current.length) flush();
    }, 20000);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      clearInterval(retry);
    };
  }, [flush]);

  /**
   * Take back a tap.
   *
   * If it is still sitting in the queue it never left the phone, so dropping it
   * locally is the whole job. If it already synced, the server deletes the log
   * and replays the trip without it.
   */
  const undo = useCallback(
    async (clientLogId) => {
      const stillQueued = queueRef.current.some((l) => l.clientLogId === clientLogId);
      if (stillQueued) {
        persist(queueRef.current.filter((l) => l.clientLogId !== clientLogId));
        return { local: true };
      }
      const res = await undoLog(tripId, clientLogId);
      onSyncedRef.current?.(res.trip);
      return res;
    },
    [tripId, persist]
  );

  return {
    queue,
    enqueue,
    undo,
    flush,
    isOnline,
    isSyncing,
    lastError,
    pendingCount: queue.length,
  };
}
