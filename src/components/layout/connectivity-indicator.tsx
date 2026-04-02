"use client";

import { useOffline } from "@/hooks/use-offline";
import { Loader2, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ConnectivityIndicator
 * Drop this anywhere in the header — it renders a compact pill showing
 * real-time connection and sync status.
 *
 * States:
 *  • Online      — green dot + "En línea"
 *  • Offline     — red dot + "Sin conexión" + pending count badge
 *  • Syncing     — amber spinning icon + "Sincronizando..."
 */
export function ConnectivityIndicator() {
  const { isOnline, isSyncing, pendingCount } = useOffline();

  // ── Syncing (takes priority over online/offline for the indicator) ──────
  if (isSyncing) {
    return (
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-full px-3 py-1",
          "bg-amber-100 text-amber-800 text-xs font-medium"
        )}
        role="status"
        aria-live="polite"
        aria-label="Sincronizando datos"
      >
        <Loader2
          size={12}
          className="animate-spin text-amber-600"
          aria-hidden="true"
        />
        <span>Sincronizando...</span>
        {pendingCount > 0 && (
          <span className="ml-0.5 rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
            {pendingCount}
          </span>
        )}
      </div>
    );
  }

  // ── Offline ─────────────────────────────────────────────────────────────
  if (!isOnline) {
    return (
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-full px-3 py-1",
          "bg-red-100 text-red-800 text-xs font-medium"
        )}
        role="status"
        aria-live="polite"
        aria-label={`Sin conexión. ${pendingCount} operaciones pendientes`}
      >
        <WifiOff size={12} className="text-red-600" aria-hidden="true" />
        <span>Sin conexión</span>
        {pendingCount > 0 && (
          <span
            className="ml-0.5 rounded-full bg-red-200 px-1.5 py-0.5 text-[10px] font-semibold text-red-900"
            title={`${pendingCount} cambios pendientes de sincronizar`}
          >
            {pendingCount}
          </span>
        )}
      </div>
    );
  }

  // ── Online ───────────────────────────────────────────────────────────────
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-1",
        "bg-green-100 text-green-800 text-xs font-medium"
      )}
      role="status"
      aria-live="polite"
      aria-label="En línea"
    >
      {/* Pulsing dot */}
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
      </span>
      <span>En línea</span>
    </div>
  );
}
