"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  FolderOpen,
  DollarSign,
  ListTodo,
  Upload,
  Shield,
  FileText,
  Settings,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  roles: string[];
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/admin", icon: <LayoutDashboard size={20} />, roles: ["admin"] },
  { label: "Dashboard", href: "/abogada", icon: <LayoutDashboard size={20} />, roles: ["abogada"] },
  { label: "Dashboard", href: "/asistente", icon: <LayoutDashboard size={20} />, roles: ["asistente"] },
  { label: "Clientes", href: "/abogada/clientes", icon: <Users size={20} />, roles: ["admin", "abogada"] },
  { label: "Casos", href: "/abogada/casos", icon: <FolderOpen size={20} />, roles: ["admin", "abogada"] },
  { label: "Gastos", href: "/abogada/gastos", icon: <DollarSign size={20} />, roles: ["admin", "abogada"] },
  { label: "Seguimiento", href: "/abogada/seguimiento", icon: <ListTodo size={20} />, roles: ["admin", "abogada"] },
  { label: "Importar", href: "/abogada/importar", icon: <Upload size={20} />, roles: ["admin", "abogada"] },
  { label: "Mis Casos", href: "/asistente/casos", icon: <FolderOpen size={20} />, roles: ["asistente"] },
  { label: "Mis Tareas", href: "/asistente/tareas", icon: <ListTodo size={20} />, roles: ["asistente"] },
  { label: "Usuarios", href: "/admin/usuarios", icon: <Shield size={20} />, roles: ["admin"] },
  { label: "Auditoría", href: "/admin/auditoria", icon: <FileText size={20} />, roles: ["admin"] },
  { label: "Configuración", href: "/admin/configuracion", icon: <Settings size={20} />, roles: ["admin"] },
];

interface SidebarProps {
  userRole: string;
  open: boolean;
  collapsed: boolean;
  onClose: () => void;
  onToggleCollapse: () => void;
}

export function Sidebar({ userRole, open, collapsed, onClose, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();
  const filteredItems = navItems.filter((item) => item.roles.includes(userRole));

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-16 left-0 z-40 flex flex-col bg-integra-navy transition-all duration-200",
          "h-[calc(100vh-4rem)]",
          // Mobile: full width overlay, slide in/out
          open ? "translate-x-0" : "-translate-x-full",
          "lg:translate-x-0",
          // Desktop: collapsed or expanded
          collapsed ? "lg:w-16" : "lg:w-64",
          // Mobile always full sidebar width
          "w-64"
        )}
      >
        {/* Mobile close button */}
        <div className="flex items-center justify-end p-2 lg:hidden">
          <button
            onClick={onClose}
            className="rounded-md p-2 text-white/70 hover:bg-white/10"
            aria-label="Cerrar menú"
          >
            <X size={20} />
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
          {filteredItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/admin" &&
                item.href !== "/abogada" &&
                item.href !== "/asistente" &&
                pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 min-h-[44px] text-sm font-medium transition-colors",
                  isActive
                    ? "bg-white/15 text-white border-l-[3px] border-integra-gold pl-[9px]"
                    : "text-white/70 hover:bg-white/10 hover:text-white",
                  collapsed && "lg:justify-center lg:px-0 lg:gap-0"
                )}
              >
                <span className="shrink-0">{item.icon}</span>
                <span className={cn("truncate", collapsed && "lg:hidden")}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* Collapse toggle (desktop only) */}
        <div className="hidden lg:flex border-t border-white/10 p-2">
          <button
            onClick={onToggleCollapse}
            className="flex w-full items-center justify-center rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white transition-colors"
            aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>
      </aside>
    </>
  );
}
