// Sync service — processes the IndexedDB queue FIFO, handles conflict
// resolution (last-write-wins) and exponential backoff retries.
// Runs only in browser context (called from the useOffline hook).

import {
  getPendingOperations,
  markSyncing,
  markSynced,
  markError,
  resetSyncingToPending,
  updateEntityId,
  type QueuedOperation,
} from "./queue";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_RETRIES = 5;
const BATCH_SIZE = 10;
const BASE_BACKOFF_MS = 1_000; // 1 s
const MAX_BACKOFF_MS = 30_000; // 30 s

// ─── Endpoint mapping ─────────────────────────────────────────────────────────

/** Maps entity name → base API path */
const ENTITY_ROUTES: Record<string, string> = {
  clients: "/api/clients",
  cases: "/api/cases",
  tasks: "/api/tasks",
  expenses: "/api/expenses",
  payments: "/api/payments",
  comments: "/api/comments",
};

function buildUrl(op: QueuedOperation): string {
  const base = ENTITY_ROUTES[op.entity];
  if (!base) throw new Error(`Unknown entity: ${op.entity}`);

  if (op.type === "create") return base;
  if (!op.entityId) throw new Error(`Missing entityId for ${op.type} on ${op.entity}`);
  return `${base}/${op.entityId}`;
}

function httpMethod(type: QueuedOperation["type"]): string {
  switch (type) {
    case "create": return "POST";
    case "update": return "PATCH";
    case "delete": return "DELETE";
  }
}

// ─── Backoff helper ───────────────────────────────────────────────────────────

export function computeBackoff(retryCount: number): number {
  const ms = BASE_BACKOFF_MS * Math.pow(2, retryCount);
  return Math.min(ms, MAX_BACKOFF_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Event emitter (lightweight) ─────────────────────────────────────────────

type SyncEvent = "start" | "progress" | "complete" | "error";
type SyncListener = (detail?: unknown) => void;

const listeners = new Map<SyncEvent, Set<SyncListener>>();

export function onSyncEvent(event: SyncEvent, fn: SyncListener): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(fn);
  return () => listeners.get(event)?.delete(fn);
}

function emit(event: SyncEvent, detail?: unknown) {
  listeners.get(event)?.forEach((fn) => fn(detail));
}

// ─── Core sync logic ──────────────────────────────────────────────────────────

async function sendOperation(op: QueuedOperation): Promise<{ serverId?: string }> {
  const url = buildUrl(op);
  const method = httpMethod(op.type);

  const body = method !== "DELETE" ? JSON.stringify(op.data) : undefined;

  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body,
  });

  // ── Conflict resolution: 409 → last-write-wins by timestamp ──────────────
  if (res.status === 409) {
    const serverData = await res.json().catch(() => ({}));
    const serverTimestamp: string | undefined = serverData?.updated_at ?? serverData?.timestamp;

    if (serverTimestamp && serverTimestamp > op.timestamp) {
      // Server wins — discard our change but acknowledge as "synced" to
      // avoid blocking the queue. Log it for auditing.
      console.warn(
        `[sync] Conflict on ${op.entity}/${op.entityId}: server version is newer. Discarding local change.`,
        { local: op.timestamp, server: serverTimestamp }
      );
      return {};
    }

    // Our version is newer — re-send as an update (PATCH) overriding server
    const overrideRes = await fetch(`${ENTITY_ROUTES[op.entity]}/${op.entityId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...op.data, _conflict_override: true }),
    });

    if (!overrideRes.ok) {
      const txt = await overrideRes.text().catch(() => overrideRes.statusText);
      throw new Error(`Override failed ${overrideRes.status}: ${txt}`);
    }

    const json = await overrideRes.json().catch(() => ({}));
    return { serverId: json?.id };
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${txt}`);
  }

  const json = await res.json().catch(() => ({}));
  return { serverId: json?.id ?? json?.data?.id };
}

// ─── SyncService ─────────────────────────────────────────────────────────────

export class SyncService {
  private running = false;

  /** Call once on app start to recover any ops that were mid-flight on last close */
  async initialize(): Promise<void> {
    await resetSyncingToPending();
  }

  /** Returns true if a sync cycle is currently active */
  get isSyncing(): boolean {
    return this.running;
  }

  /**
   * Process the queue in FIFO order, up to BATCH_SIZE at a time.
   * Safe to call concurrently — second call is a no-op while one is running.
   */
  async processQueue(): Promise<void> {
    if (this.running) return;
    this.running = true;
    emit("start");

    try {
      const pending = await getPendingOperations();
      const batch = pending.slice(0, BATCH_SIZE);

      if (batch.length === 0) {
        emit("complete", { synced: 0 });
        return;
      }

      let synced = 0;
      let errors = 0;

      for (const op of batch) {
        // Skip ops that have exhausted retries — they need manual resolution
        if (op.retryCount >= MAX_RETRIES && op.status === "error") {
          errors++;
          continue;
        }

        // Apply backoff for retried ops
        if (op.retryCount > 0) {
          await sleep(computeBackoff(op.retryCount - 1));
        }

        await markSyncing(op.id);

        try {
          const result = await sendOperation(op);

          // If this was a "create", store the returned server ID so future
          // update/delete ops in the queue can reference the correct row.
          if (op.type === "create" && result.serverId) {
            await updateEntityId(op.id, result.serverId);
          }

          await markSynced(op.id);
          synced++;
          emit("progress", { synced, total: batch.length });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await markError(op.id, message);
          errors++;

          const updatedRetryCount = op.retryCount + 1;

          if (updatedRetryCount >= MAX_RETRIES) {
            // Alert user to unresolvable operation
            console.error(
              `[sync] Operation ${op.id} (${op.type} ${op.entity}) failed after ${MAX_RETRIES} retries. Last error: ${message}`
            );
            emit("error", {
              op,
              message: `No se pudo sincronizar la operación ${op.type} en ${op.entity} después de ${MAX_RETRIES} intentos.`,
            });
          }
        }
      }

      emit("complete", { synced, errors, total: batch.length });
    } finally {
      this.running = false;
    }
  }
}

/** Singleton used across the app */
export const syncService = new SyncService();
