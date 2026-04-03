"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  FolderOpen,
  ListTodo,
  DollarSign,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface BottomNavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const adminNav: BottomNavItem[] = [
  { label: "Inicio", href: "/admin", icon: <LayoutDashboard size={20} /> },
  { label: "Clientes", href: "/abogada/clientes", icon: <Users size={20} /> },
  { label: "Casos", href: "/abogada/expedientes", icon: <FolderOpen size={20} /> },
  { label: "Tareas", href: "/abogada/tareas", icon: <ListTodo size={20} /> },
];

const abogadaNav: BottomNavItem[] = [
  { label: "Inicio", href: "/abogada", icon: <LayoutDashboard size={20} /> },
  { label: "Clientes", href: "/abogada/clientes", icon: <Users size={20} /> },
  { label: "Casos", href: "/abogada/expedientes", icon: <FolderOpen size={20} /> },
  { label: "Gastos", href: "/abogada/gastos", icon: <DollarSign size={20} /> },
];

const asistenteNav: BottomNavItem[] = [
  { label: "Inicio", href: "/asistente", icon: <LayoutDashboard size={20} /> },
  { label: "Casos", href: "/asistente/casos", icon: <FolderOpen size={20} /> },
  { label: "Tareas", href: "/asistente/tareas", icon: <ListTodo size={20} /> },
  { label: "Gastos", href: "/asistente/gastos", icon: <DollarSign size={20} /> },
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
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
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
