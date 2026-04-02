// Connectivity service — tracks real online/offline state using both
// navigator.onLine and periodic pings to /api/health. Triggers sync
// automatically on reconnect.

import { syncService } from "./sync";

// ─── Types ────────────────────────────────────────────────────────────────────

type ConnectivityEvent = "online" | "offline";
type ConnectivityListener = () => void;

// ─── Constants ────────────────────────────────────────────────────────────────

const PING_URL = "/api/health";
const PING_INTERVAL_MS = 30_000; // 30 s
const PING_TIMEOUT_MS = 5_000;   // 5 s fetch abort

// ─── ConnectivityService ──────────────────────────────────────────────────────

export class ConnectivityService {
  private _isOnline: boolean = typeof navigator !== "undefined"
    ? navigator.onLine
    : true;

  private listeners = new Map<ConnectivityEvent, Set<ConnectivityListener>>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;

  // ── Public state ──────────────────────────────────────────────────────────

  get isOnline(): boolean {
    return this._isOnline;
  }

  // ── Event subscription ────────────────────────────────────────────────────

  on(event: ConnectivityEvent, fn: ConnectivityListener): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  private emit(event: ConnectivityEvent) {
    this.listeners.get(event)?.forEach((fn) => fn());
  }

  // ── State transition ──────────────────────────────────────────────────────

  private setOnline(value: boolean) {
    if (value === this._isOnline) return; // no change
    const wasOffline = !this._isOnline;
    this._isOnline = value;

    if (value) {
      this.emit("online");
      // Trigger sync immediately on reconnect
      if (wasOffline) {
        syncService.processQueue().catch((err) =>
          console.error("[connectivity] Auto-sync on reconnect failed:", err)
        );
      }
    } else {
      this.emit("offline");
    }
  }

  // ── Ping ─────────────────────────────────────────────────────────────────

  private async ping(): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

    try {
      const res = await fetch(PING_URL, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      this.setOnline(res.ok);
    } catch {
      // Network error or abort → offline
      this.setOnline(false);
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Start listening to browser connectivity events and periodic pings.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  start(): void {
    if (this.initialized || typeof window === "undefined") return;
    this.initialized = true;

    // Browser events (fast but unreliable on some networks)
    window.addEventListener("online", () => {
      this.setOnline(true);
      // Do an immediate ping to confirm the network truly works
      this.ping().catch(() => {});
    });

    window.addEventListener("offline", () => {
      this.setOnline(false);
    });

    // Periodic deep-check ping
    this.pingTimer = setInterval(() => {
      this.ping().catch(() => {});
    }, PING_INTERVAL_MS);

    // Initial ping to verify actual connectivity
    this.ping().catch(() => {});
  }

  /**
   * Stop all listeners and timers. Useful in tests.
   */
  stop(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.initialized = false;
  }
}

/** Singleton used across the app */
export const connectivityService = new ConnectivityService();
