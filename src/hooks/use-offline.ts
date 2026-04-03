"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  addToQueue,
  getPendingCount,
  clearSynced,
  type NewOperation,
  type QueuedOperation,
} from "@/lib/offline/queue";
import { syncService, onSyncEvent } from "@/lib/offline/sync";
import { connectivityService } from "@/lib/offline/connectivity";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseOfflineReturn {
  /** True when the server is reachable */
  isOnline: boolean;
  /** True while a sync cycle is running */
  isSyncing: boolean;
  /** Number of unsynced operations in the queue */
  pendingCount: number;
  /**
   * Queue a write operation.
   * Adds to IndexedDB immediately (data-safe), then fires the network request
   * if online. The returned QueuedOperation includes the local queue ID.
   */
  queueOperation: (op: NewOperation) => Promise<QueuedOperation>;
  /** Manually trigger a sync attempt */
  syncNow: () => Promise<void>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOffline(): UseOfflineReturn {
  // Start with `true` on both server and client to avoid hydration mismatch.
  // The real value is picked up in the useEffect below.
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  // Ref so that callbacks always see the latest value without re-subscribing
  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;

  // ── Refresh pending count ────────────────────────────────────────────────

  const refreshCount = useCallback(async () => {
    const count = await getPendingCount();
    setPendingCount(count);
  }, []);

  // ── Boot: start services, recover stuck ops, seed count ─────────────────

  useEffect(() => {
    // Initialize once on mount — set real connectivity state
    setIsOnline(navigator.onLine);
    syncService.initialize().catch(console.error);
    connectivityService.start();
    refreshCount().catch(console.error);

    // Connectivity events
    const unsubOnline = connectivityService.on("online", () => {
      setIsOnline(true);
    });
    const unsubOffline = connectivityService.on("offline", () => {
      setIsOnline(false);
    });

    // Sync lifecycle events
    const unsubStart = onSyncEvent("start", () => {
      setIsSyncing(true);
    });
    const unsubComplete = onSyncEvent("complete", () => {
      setIsSyncing(false);
      refreshCount().catch(console.error);
      // Clean up old synced records periodically
      clearSynced().catch(console.error);
    });
    const unsubError = onSyncEvent("error", (detail) => {
      console.error("[useOffline] Sync error:", detail);
      setIsSyncing(false);
      refreshCount().catch(console.error);
    });

    return () => {
      unsubOnline();
      unsubOffline();
      unsubStart();
      unsubComplete();
      unsubError();
    };
  }, [refreshCount]);

  // ── queueOperation ───────────────────────────────────────────────────────

  const queueOperation = useCallback(
    async (op: NewOperation): Promise<QueuedOperation> => {
      // 1. Persist to IndexedDB FIRST — data-safe regardless of network
      const queued = await addToQueue(op);

      // Update count immediately for reactive UI
      setPendingCount((prev) => prev + 1);

      // 2. Attempt immediate sync only if online and not already syncing
      if (isOnlineRef.current && !syncService.isSyncing) {
        syncService.processQueue().catch((err) =>
          console.error("[useOffline] Immediate sync failed:", err)
        );
      }

      return queued;
    },
    []
  );

  // ── syncNow ──────────────────────────────────────────────────────────────

  const syncNow = useCallback(async () => {
    if (!isOnlineRef.current) return;
    await syncService.processQueue();
  }, []);

  return { isOnline, isSyncing, pendingCount, queueOperation, syncNow };
}
