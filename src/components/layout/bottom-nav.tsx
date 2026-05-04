"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  FolderOpen,
  ListTodo,
  DollarSign,
  Home,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface BottomNavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const adminNav: BottomNavItem[] = [
  { label: "Inicio",      href: "/",                  icon: <Home size={20} /> },
  { label: "Dashboard",   href: "/legal",             icon: <LayoutDashboard size={20} /> },
  { label: "Clientes",    href: "/legal/clientes",    icon: <Users size={20} /> },
  { label: "Casos",       href: "/legal/casos",       icon: <FolderOpen size={20} /> },
  { label: "Seguimiento", href: "/legal/seguimiento", icon: <ListTodo size={20} /> },
];

const abogadaNav: BottomNavItem[] = [
  { label: "Inicio",    href: "/",                icon: <Home size={20} /> },
  { label: "Dashboard", href: "/legal",           icon: <LayoutDashboard size={20} /> },
  { label: "Clientes",  href: "/legal/clientes",  icon: <Users size={20} /> },
  { label: "Casos",     href: "/legal/casos",     icon: <FolderOpen size={20} /> },
  { label: "Gastos",    href: "/legal/gastos",    icon: <DollarSign size={20} /> },
];

const asistenteNav: BottomNavItem[] = [
  { label: "Inicio",     href: "/",                 icon: <Home size={20} /> },
  { label: "Dashboard",  href: "/legal",            icon: <LayoutDashboard size={20} /> },
  { label: "Casos",      href: "/legal/casos",      icon: <FolderOpen size={20} /> },
  { label: "Pendientes", href: "/legal/pendientes", icon: <ListTodo size={20} /> },
];

const navByRole: Record<string, BottomNavItem[]> = {
  admin: adminNav,
  abogada: abogadaNav,
  asistente: asistenteNav,
};

interface BottomNavProps {
  userRole: string;
}

export function BottomNav({ userRole }: BottomNavProps) {
  const pathname = usePathname();
  const items = navByRole[userRole] || abogadaNav;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-white lg:hidden">
      <div className="flex items-center justify-around">
        {items.map((item) => {
          // Para rutas raíz solo activamos en match exacto, no en sub-paths.
          const isRootLike = item.href === "/" || item.href === "/legal";
          const isActive =
            pathname === item.href ||
            (!isRootLike && pathname.startsWith(item.href + "/"));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 py-2 text-xs",
                isActive
                  ? "text-integra-navy font-semibold"
                  : "text-gray-500"
              )}
            >
              <span className={cn(
                "rounded-full p-1",
                isActive && "bg-integra-gold/20"
              )}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
