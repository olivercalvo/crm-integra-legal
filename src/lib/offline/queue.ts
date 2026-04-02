// Offline operation queue — persists ALL write operations in IndexedDB
// before they reach the server. Guarantees ZERO data loss across page reloads.
import { openDB, type IDBPDatabase } from "idb";

// ─── Types ────────────────────────────────────────────────────────────────────

export type OperationType = "create" | "update" | "delete";
export type OperationStatus = "pending" | "syncing" | "synced" | "error";

export interface QueuedOperation {
  /** UUID generated client-side */
  id: string;
  /** ISO-8601 — used for last-write-wins conflict resolution */
  timestamp: string;
  type: OperationType;
  /** e.g. "clients", "cases", "tasks", "expenses", "payments", "comments" */
  entity: string;
  /** Server-side row ID (undefined for "create" before the server responds) */
  entityId?: string;
  /** Full payload to send to the API */
  data: Record<string, unknown>;
  status: OperationStatus;
  retryCount: number;
  lastError?: string;
}

export type NewOperation = Pick<
  QueuedOperation,
  "type" | "entity" | "entityId" | "data"
>;

// ─── DB setup ─────────────────────────────────────────────────────────────────

const DB_NAME = "crm-integra-offline";
const STORE = "operations";
const DB_VERSION = 1;

let _db: IDBPDatabase | null = null;

async function getDb(): Promise<IDBPDatabase> {
  if (_db) return _db;

  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        // Index for FIFO ordering and status filtering
        store.createIndex("by_timestamp", "timestamp");
        store.createIndex("by_status", "status");
      }
    },
  });

  return _db;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Persist a new write operation. Returns the stored record.
 * This MUST be called before any network request.
 */
export async function addToQueue(op: NewOperation): Promise<QueuedOperation> {
  const db = await getDb();

  const record: QueuedOperation = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    type: op.type,
    entity: op.entity,
    entityId: op.entityId,
    data: op.data,
    status: "pending",
    retryCount: 0,
  };

  await db.add(STORE, record);
  return record;
}

/**
 * Return all queued operations, ordered oldest-first (FIFO).
 */
export async function getQueue(): Promise<QueuedOperation[]> {
  const db = await getDb();
  return db.getAllFromIndex(STORE, "by_timestamp");
}

/**
 * Return only pending + error operations (skips already-synced rows).
 */
export async function getPendingOperations(): Promise<QueuedOperation[]> {
  const all = await getQueue();
  return all.filter((op) => op.status === "pending" || op.status === "error");
}

/**
 * Return count of operations that have not yet been synced.
 */
export async function getPendingCount(): Promise<number> {
  const pending = await getPendingOperations();
  return pending.length;
}

/**
 * Mark an operation as currently being synced (prevents duplicate sends).
 */
export async function markSyncing(id: string): Promise<void> {
  const db = await getDb();
  const record = await db.get(STORE, id);
  if (!record) return;
  await db.put(STORE, { ...record, status: "syncing" } satisfies QueuedOperation);
}

/**
 * Mark an operation as successfully synced.
 * Preserves the record until clearSynced() is called so we can audit the log.
 */
export async function markSynced(id: string): Promise<void> {
  const db = await getDb();
  const record = await db.get(STORE, id);
  if (!record) return;
  await db.put(STORE, {
    ...record,
    status: "synced",
    lastError: undefined,
  } satisfies QueuedOperation);
}

/**
 * Increment retryCount and store the latest error message.
 * If retryCount >= MAX_RETRIES the caller should mark the op as "error".
 */
export async function markError(id: string, error: string): Promise<void> {
  const db = await getDb();
  const record: QueuedOperation | undefined = await db.get(STORE, id);
  if (!record) return;
  await db.put(STORE, {
    ...record,
    status: "error",
    retryCount: record.retryCount + 1,
    lastError: error,
  } satisfies QueuedOperation);
}

/**
 * Reset a stuck "syncing" op back to "pending" (used on startup to recover
 * from a page-close that happened mid-sync).
 */
export async function resetSyncingToPending(): Promise<void> {
  const db = await getDb();
  const all = await getQueue();
  const stuck = all.filter((op) => op.status === "syncing");
  for (const op of stuck) {
    await db.put(STORE, { ...op, status: "pending" } satisfies QueuedOperation);
  }
}

/**
 * Remove all "synced" operations. Call periodically to keep the store lean.
 */
export async function clearSynced(): Promise<number> {
  const db = await getDb();
  const all = await getQueue();
  const synced = all.filter((op) => op.status === "synced");
  for (const op of synced) {
    await db.delete(STORE, op.id);
  }
  return synced.length;
}

/**
 * Update the entityId once a "create" operation receives its server ID.
 * This lets subsequent "update" / "delete" ops reference the correct row.
 */
export async function updateEntityId(
  queueId: string,
  entityId: string
): Promise<void> {
  const db = await getDb();
  const record: QueuedOperation | undefined = await db.get(STORE, queueId);
  if (!record) return;
  await db.put(STORE, { ...record, entityId });
}
