"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { getActiveTab, getBottomNavItems, isItemActive } from "@/lib/nav-config";

interface BottomNavProps {
  userRole: string;
}

/**
 * BottomNav mobile — atajos del tab activo según el rol.
 * Los items vienen de nav-config (única fuente de verdad), por lo que
 * roles especializados (contador, asistente) ven sus propios atajos sin
 * caer a fallback. Si no hay items (ej: estás en `/`), no se renderiza.
 */
export function BottomNav({ userRole }: BottomNavProps) {
  const pathname = usePathname();
  const activeTab = getActiveTab(pathname);
  const items = getBottomNavItems(activeTab, userRole);

  if (items.length === 0) return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-white lg:hidden">
      <div className="flex items-center justify-around">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isItemActive(item.href, pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 py-2 text-xs",
                active ? "text-integra-navy font-semibold" : "text-gray-500"
              )}
            >
              <span className={cn("rounded-full p-1", active && "bg-integra-gold/20")}>
                <Icon size={20} />
              </span>
              <span className="truncate max-w-[64px]">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
