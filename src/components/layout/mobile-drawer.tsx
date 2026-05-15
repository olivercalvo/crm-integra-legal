"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getActiveTab, getSidebarItems, getVisibleTabs, isItemActive } from "@/lib/nav-config";

interface MobileDrawerProps {
  userRole: string;
  open: boolean;
  onClose: () => void;
}

/**
 * Drawer mobile — overlay slide-in desde la izquierda.
 * Muestra los tabs visibles arriba y los items del tab activo abajo.
 * Solo se renderiza en pantallas < lg.
 */
export function MobileDrawer({ userRole, open, onClose }: MobileDrawerProps) {
  const pathname = usePathname();
  const activeTab = getActiveTab(pathname);
  const tabs = getVisibleTabs(userRole);
  const items = getSidebarItems(activeTab, userRole);

  return (
    <>
      {/* Overlay */}
      <div
        className={cn(
          "fixed inset-0 z-50 bg-black/50 transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
        aria-hidden={!open}
      />

      {/* Panel */}
      <aside
        className={cn(
          "fixed top-0 left-0 z-50 flex h-full w-72 max-w-[85vw] flex-col bg-integra-navy transition-transform duration-200 lg:hidden",
          open ? "translate-x-0" : "-translate-x-full"
        )}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-base font-bold text-white">
            Integra <span className="text-integra-gold">Legal</span>
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-white/70 hover:bg-white/10"
            aria-label="Cerrar menú"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tabs (módulos) */}
        {tabs.length > 1 && (
          <div className="border-b border-white/10 px-3 py-3">
            <p className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">
              Módulos
            </p>
            <div className="flex flex-wrap gap-2">
              {tabs.map((tab) => {
                const TabIcon = tab.icon;
                const isActive = tab.id === activeTab;
                return (
                  <Link
                    key={tab.id}
                    href={tab.href}
                    onClick={onClose}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                      isActive
                        ? "bg-integra-gold text-integra-navy"
                        : "bg-white/10 text-white/70 hover:bg-white/15 hover:text-white"
                    )}
                  >
                    <TabIcon size={14} />
                    {tab.shortLabel}
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Items del tab activo */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
          {items.length === 0 ? (
            <p className="px-3 py-2 text-sm text-white/50">
              Selecciona un módulo arriba para ver las opciones.
            </p>
          ) : (
            items.map((item) => {
              const Icon = item.icon;
              const active = isItemActive(item.href, pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 min-h-[48px] text-sm font-medium transition-colors",
                    active
                      ? "bg-white/15 text-white border-l-[3px] border-integra-gold pl-[9px]"
                      : "text-white/70 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <Icon size={20} />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })
          )}
        </nav>
      </aside>
    </>
  );
}
