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
  Home,
  X,
  ClipboardList,
  UserPlus,
  Receipt,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  roles: string[];
  /** Sección lógica para renderizar separadores entre módulos. */
  section?: "general" | "legal" | "finanzas" | "admin";
}

// "Inicio" lleva al selector de módulos (raíz). Es la primera entrada para
// que el usuario siempre tenga vuelta a la pantalla de selección.
const navItems: NavItem[] = [
  { label: "Inicio",         href: "/",                          icon: <Home size={20} />,            roles: ["admin", "abogada", "asistente", "contador"], section: "general" },
  { label: "Dashboard",      href: "/legal",                     icon: <LayoutDashboard size={20} />, roles: ["admin", "abogada", "asistente"],              section: "legal" },
  { label: "Clientes",       href: "/legal/clientes",            icon: <Users size={20} />,           roles: ["admin", "abogada"],                           section: "legal" },
  { label: "Casos",          href: "/legal/casos",               icon: <FolderOpen size={20} />,      roles: ["admin", "abogada", "asistente"],              section: "legal" },
  { label: "Gastos",         href: "/legal/gastos",              icon: <DollarSign size={20} />,      roles: ["admin", "abogada", "asistente"],              section: "legal" },
  { label: "Seguimiento",    href: "/legal/seguimiento",         icon: <ListTodo size={20} />,        roles: ["admin", "abogada"],                           section: "legal" },
  { label: "Mis Pendientes", href: "/legal/pendientes",          icon: <ClipboardList size={20} />,   roles: ["admin", "abogada", "asistente"],              section: "legal" },
  { label: "Prospectos",     href: "/legal/prospectos",          icon: <UserPlus size={20} />,        roles: ["admin", "abogada"],                           section: "legal" },
  { label: "Importar",       href: "/legal/importar",            icon: <Upload size={20} />,          roles: ["admin", "abogada"],                           section: "legal" },
  // Finanzas (gating server-side: middleware redirige asistentes fuera de /finanzas;
  // contador queda confinado a /finanzas/reportes/*).
  { label: "Cotizaciones",   href: "/finanzas/cotizaciones",     icon: <FileText size={20} />,        roles: ["admin", "abogada"],                           section: "finanzas" },
  { label: "Plantilla T&C",  href: "/finanzas/cotizaciones/configuracion", icon: <Settings size={20} />, roles: ["admin"],                                  section: "finanzas" },
  { label: "Facturas",       href: "/finanzas/facturas",         icon: <Receipt size={20} />,         roles: ["admin", "abogada"],                           section: "finanzas" },
  { label: "Reportes",       href: "/finanzas/reportes",         icon: <BarChart3 size={20} />,       roles: ["admin", "abogada", "contador"],               section: "finanzas" },
  // Admin (gating server-side)
  { label: "Admin",          href: "/legal/admin",               icon: <Shield size={20} />,          roles: ["admin"],                                      section: "admin" },
  { label: "Usuarios",       href: "/legal/admin/usuarios",      icon: <Shield size={20} />,          roles: ["admin"],                                      section: "admin" },
  { label: "Auditoría",      href: "/legal/admin/auditoria",     icon: <FileText size={20} />,        roles: ["admin"],                                      section: "admin" },
  { label: "Configuración",  href: "/legal/admin/configuracion", icon: <Settings size={20} />,        roles: ["admin"],                                      section: "admin" },
];

const SECTION_LABEL: Record<NonNullable<NavItem["section"]>, string> = {
  general: "",
  legal: "GESTIÓN LEGAL",
  finanzas: "FINANZAS",
  admin: "ADMINISTRACIÓN",
};

/**
 * Visibilidad de SECCIONES por rol — capa adicional sobre los `roles` por
 * ítem. Aunque un rol matchee `item.roles`, si la sección NO está habilitada
 * para ese rol el ítem no se muestra. Permite ocultar módulos completos
 * para roles especializados (ej: contador NO ve Gestión Legal aunque
 * algunos ítems individuales lo permitan en el futuro).
 *
 * - admin:     ve TODO
 * - abogada:   legal + finanzas
 * - asistente: solo legal
 * - contador:  solo finanzas
 *
 * "general" (Inicio) es siempre visible — es la salida al selector de módulos.
 */
const SECTION_ROLES: Record<NonNullable<NavItem["section"]>, string[]> = {
  general:  ["admin", "abogada", "asistente", "contador"],
  legal:    ["admin", "abogada", "asistente"],
  finanzas: ["admin", "abogada", "contador"],
  admin:    ["admin"],
};

interface SidebarProps {
  userRole: string;
  open: boolean;
  collapsed: boolean;
  onClose: () => void;
  onToggleCollapse: () => void;
}

export function Sidebar({ userRole, open, collapsed, onClose, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();
  const filteredItems = navItems.filter((item) => {
    // Doble guard: el ítem debe permitir el rol Y la sección del ítem debe
    // estar habilitada para ese rol. Esto evita que un ítem nuevo agregado
    // por error a una sección "ajena" se filtre por error.
    if (!item.roles.includes(userRole)) return false;
    if (!item.section) return true;
    return SECTION_ROLES[item.section].includes(userRole);
  });

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
          {filteredItems.map((item, idx) => {
            // Para rutas raíz ("/" y "/legal") solo activamos en match exacto.
            // Para subrutas activamos también si el pathname es subdirectorio.
            const isRootLike = item.href === "/" || item.href === "/legal" || item.href === "/legal/admin";
            const isActive =
              pathname === item.href ||
              (!isRootLike && pathname.startsWith(item.href + "/"));

            // Renderizar header de sección cuando cambia respecto del ítem
            // anterior. Ocultos cuando el sidebar está colapsado.
            const prev = idx > 0 ? filteredItems[idx - 1] : null;
            const showSectionHeader =
              item.section &&
              item.section !== "general" &&
              item.section !== prev?.section;

            return (
              <div key={item.href}>
                {showSectionHeader && (
                  <div
                    className={cn(
                      "px-3 pt-3 pb-1 text-[10px] font-semibold tracking-wider text-white/40",
                      collapsed && "lg:hidden"
                    )}
                  >
                    {SECTION_LABEL[item.section!]}
                  </div>
                )}
                <Link
                  href={item.href}
                  onClick={onClose}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 min-h-[44px] text-sm font-medium transition-all duration-200",
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
              </div>
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
