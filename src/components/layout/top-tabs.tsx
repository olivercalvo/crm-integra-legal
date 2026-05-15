"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getActiveTab, getVisibleTabs } from "@/lib/nav-config";
import { cn } from "@/lib/utils";

interface TopTabsProps {
  userRole: string;
  /** Variante visual:
   * - "desktop": inline en el header, scroll horizontal si no caben.
   * - "mobile":  fila completa debajo del header en pantallas chicas.
   */
  variant?: "desktop" | "mobile";
}

export function TopTabs({ userRole, variant = "desktop" }: TopTabsProps) {
  const pathname = usePathname();
  const activeTab = getActiveTab(pathname);
  const tabs = getVisibleTabs(userRole);

  if (tabs.length === 0) return null;

  if (variant === "mobile") {
    return (
      <nav
        aria-label="Módulos"
        className="flex items-center gap-1 overflow-x-auto border-b border-gray-200 bg-white px-2 py-2 lg:hidden"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === activeTab;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                isActive
                  ? "bg-integra-navy text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              <Icon size={14} />
              {tab.shortLabel}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav aria-label="Módulos" className="hidden lg:flex items-center gap-1">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.id === activeTab;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-integra-navy text-white shadow-sm"
                : "text-gray-600 hover:bg-gray-100 hover:text-integra-navy"
            )}
          >
            <Icon size={16} className={isActive ? "text-integra-gold" : ""} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
