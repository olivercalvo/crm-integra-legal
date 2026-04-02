"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  FolderOpen,
  DollarSign,
  ListTodo,
  Settings,
  FileText,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  roles: string[];
}

const navItems: NavItem[] = [
  {
    label: "Dashboard",
    href: "/admin",
    icon: <LayoutDashboard size={20} />,
    roles: ["admin"],
  },
  {
    label: "Dashboard",
    href: "/abogada",
    icon: <LayoutDashboard size={20} />,
    roles: ["abogada"],
  },
  {
    label: "Dashboard",
    href: "/asistente",
    icon: <LayoutDashboard size={20} />,
    roles: ["asistente"],
  },
  {
    label: "Clientes",
    href: "/abogada/clientes",
    icon: <Users size={20} />,
    roles: ["admin", "abogada"],
  },
  {
    label: "Expedientes",
    href: "/abogada/expedientes",
    icon: <FolderOpen size={20} />,
    roles: ["admin", "abogada"],
  },
  {
    label: "Gastos",
    href: "/abogada/gastos",
    icon: <DollarSign size={20} />,
    roles: ["admin", "abogada"],
  },
  {
    label: "Tareas",
    href: "/abogada/tareas",
    icon: <ListTodo size={20} />,
    roles: ["admin", "abogada"],
  },
  {
    label: "Mis Casos",
    href: "/asistente/casos",
    icon: <FolderOpen size={20} />,
    roles: ["asistente"],
  },
  {
    label: "Mis Tareas",
    href: "/asistente/tareas",
    icon: <ListTodo size={20} />,
    roles: ["asistente"],
  },
  {
    label: "Importar",
    href: "/abogada/importar",
    icon: <Upload size={20} />,
    roles: ["admin", "abogada"],
  },
  {
    label: "Auditoría",
    href: "/admin/auditoria",
    icon: <FileText size={20} />,
    roles: ["admin"],
  },
  {
    label: "Configuración",
    href: "/admin/configuracion",
    icon: <Settings size={20} />,
    roles: ["admin"],
  },
];

interface SidebarProps {
  userRole: string;
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ userRole, open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const filtered = navItems.filter((item) => item.roles.includes(userRole));

  return (
    <>
      {/* Overlay for mobile */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-16 z-40 h-[calc(100vh-4rem)] w-64 border-r bg-white transition-transform duration-200 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <nav className="flex flex-col gap-1 p-4">
          {filtered.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors min-h-[48px]",
                  isActive
                    ? "bg-integra-navy text-white"
                    : "text-gray-700 hover:bg-gray-100"
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
