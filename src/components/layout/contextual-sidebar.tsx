"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Pin, PinOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { getActiveTab, getSidebarItems, isItemActive } from "@/lib/nav-config";

const STORAGE_KEY = "nav-sidebar-mode";
type Mode = "pinned" | "auto";

interface ContextualSidebarProps {
  userRole: string;
  /** Notifica el modo actual al shell para que ajuste el margen del main. */
  onModeChange?: (mode: Mode) => void;
}

/**
 * Sidebar contextual minimal estilo Linear:
 * - Default colapsado a 64px (solo iconos).
 * - Hover: se expande a 240px ENCIMA del contenido (overlay, no empuja).
 * - Pin: 240px persistente, empuja el main (vía onModeChange + ml-60 en shell).
 * - Persistencia en localStorage key "nav-sidebar-mode".
 * - Oculto en mobile — ahí usa MobileDrawer.
 */
export function ContextualSidebar({ userRole, onModeChange }: ContextualSidebarProps) {
  const pathname = usePathname();
  const [mode, setMode] = useState<Mode>("auto");
  const [hovered, setHovered] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "pinned" || saved === "auto") {
        setMode(saved);
        onModeChange?.(saved);
      } else {
        onModeChange?.("auto");
      }
    } catch {
      onModeChange?.("auto");
    }
    setHydrated(true);
  }, [onModeChange]);

  function toggleMode() {
    setMode((prev) => {
      const next: Mode = prev === "pinned" ? "auto" : "pinned";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {}
      onModeChange?.(next);
      // Al pinear desde hover, dejamos hover en false para que el width
      // refleje el modo pinned sin doble-clase.
      if (next === "pinned") setHovered(false);
      return next;
    });
  }

  const activeTab = getActiveTab(pathname);
  const items = getSidebarItems(activeTab, userRole);

  // No mostrar sidebar si no hay items para este tab/rol (ej: estás en `/`
  // sin tab activo). El layout sigue funcionando sin él.
  if (items.length === 0) return null;

  const expanded = mode === "pinned" || hovered;

  return (
    <aside
      onMouseEnter={() => mode === "auto" && setHovered(true)}
      onMouseLeave={() => mode === "auto" && setHovered(false)}
      className={cn(
        "fixed top-16 left-0 z-40 hidden lg:flex flex-col bg-integra-navy",
        "h-[calc(100vh-4rem)] transition-[width] duration-200 ease-out",
        expanded ? "w-60" : "w-16",
        // Sombra solo cuando está flotando por hover (no pinned)
        hovered && mode === "auto" && "shadow-2xl",
        // Suprime transición pre-hidratación para evitar flash
        !hydrated && "transition-none"
      )}
    >
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3 space-y-1">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isItemActive(item.href, pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={!expanded ? item.label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg min-h-[44px] text-sm font-medium transition-colors",
                expanded ? "px-3" : "justify-center px-0",
                active
                  ? "bg-white/15 text-white border-l-[3px] border-integra-gold"
                  : "text-white/70 hover:bg-white/10 hover:text-white",
                active && expanded && "pl-[9px]"
              )}
            >
              <span className="shrink-0">
                <Icon size={20} />
              </span>
              <span
                className={cn(
                  "truncate transition-opacity duration-150",
                  expanded ? "opacity-100" : "opacity-0 w-0 hidden"
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-2">
        <button
          onClick={toggleMode}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white transition-colors",
            expanded ? "justify-start" : "justify-center"
          )}
          aria-label={mode === "pinned" ? "Desfijar menú" : "Fijar menú"}
          title={mode === "pinned" ? "Desfijar menú" : "Fijar menú"}
        >
          {mode === "pinned" ? <PinOff size={16} /> : <Pin size={16} />}
          {expanded && (
            <span className="text-xs">
              {mode === "pinned" ? "Desfijar" : "Fijar menú"}
            </span>
          )}
        </button>
      </div>
    </aside>
  );
}
