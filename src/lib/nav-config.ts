import type { LucideIcon } from "lucide-react";
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
  ClipboardList,
  UserPlus,
  Receipt,
  BarChart3,
  ShoppingBag,
  Scale,
  Wallet,
} from "lucide-react";

export type Role = "admin" | "abogada" | "asistente" | "contador";
export type TabId = "legal" | "finanzas" | "admin";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  roles: Role[];
}

export interface TabDef {
  id: TabId;
  label: string;
  shortLabel: string;
  href: string;
  icon: LucideIcon;
  roles: Role[];
  items: NavItem[];
}

// Fuente única de verdad para la navegación.
// - Cada tab agrupa las pantallas de un módulo.
// - El gating server-side de rutas (middleware) sigue mandando — esto solo
//   controla qué se ve en la UI.
// - "Admin" es un tab propio aunque sus rutas vivan bajo /legal/admin: el
//   matcher de tab activo prioriza /legal/admin sobre /legal.
export const TABS: TabDef[] = [
  {
    id: "legal",
    label: "Gestión Legal",
    shortLabel: "Legal",
    href: "/legal",
    icon: Scale,
    roles: ["admin", "abogada", "asistente"],
    items: [
      { label: "Dashboard",      href: "/legal",            icon: LayoutDashboard, roles: ["admin", "abogada", "asistente"] },
      { label: "Clientes",       href: "/legal/clientes",   icon: Users,           roles: ["admin", "abogada"] },
      { label: "Casos",          href: "/legal/casos",      icon: FolderOpen,      roles: ["admin", "abogada", "asistente"] },
      { label: "Gastos",         href: "/legal/gastos",     icon: DollarSign,      roles: ["admin", "abogada", "asistente"] },
      { label: "Seguimiento",    href: "/legal/seguimiento", icon: ListTodo,       roles: ["admin", "abogada"] },
      { label: "Mis Pendientes", href: "/legal/pendientes", icon: ClipboardList,   roles: ["admin", "abogada", "asistente"] },
      { label: "Prospectos",     href: "/legal/prospectos", icon: UserPlus,        roles: ["admin", "abogada"] },
      { label: "Importar",       href: "/legal/importar",   icon: Upload,          roles: ["admin", "abogada"] },
    ],
  },
  {
    id: "finanzas",
    label: "Finanzas",
    shortLabel: "Finanzas",
    href: "/finanzas",
    icon: Wallet,
    roles: ["admin", "abogada", "contador"],
    items: [
      { label: "Cotizaciones",      href: "/finanzas/cotizaciones",               icon: FileText,    roles: ["admin", "abogada"] },
      { label: "Plantilla T&C",     href: "/finanzas/cotizaciones/configuracion", icon: Settings,    roles: ["admin"] },
      { label: "Facturas",          href: "/finanzas/facturas",                   icon: Receipt,     roles: ["admin", "abogada"] },
      { label: "Gastos del Bufete", href: "/finanzas/gastos-bufete",              icon: ShoppingBag, roles: ["admin", "abogada", "contador"] },
      { label: "Reportes",          href: "/finanzas/reportes",                   icon: BarChart3,   roles: ["admin", "abogada", "contador"] },
    ],
  },
  {
    id: "admin",
    label: "Administración",
    shortLabel: "Admin",
    href: "/legal/admin",
    icon: Shield,
    roles: ["admin"],
    items: [
      { label: "Panel Admin",   href: "/legal/admin",               icon: Shield,   roles: ["admin"] },
      { label: "Usuarios",      href: "/legal/admin/usuarios",      icon: Users,    roles: ["admin"] },
      { label: "Auditoría",     href: "/legal/admin/auditoria",     icon: FileText, roles: ["admin"] },
      { label: "Configuración", href: "/legal/admin/configuracion", icon: Settings, roles: ["admin"] },
    ],
  },
];

// Mapea un pathname al tab al que pertenece. Orden de chequeo importa:
// /legal/admin debe matchear ANTES que /legal.
export function getActiveTab(pathname: string): TabId | null {
  if (pathname.startsWith("/legal/admin")) return "admin";
  if (pathname.startsWith("/finanzas")) return "finanzas";
  if (pathname.startsWith("/legal")) return "legal";
  return null;
}

export function getVisibleTabs(role: string): TabDef[] {
  return TABS.filter((t) => t.roles.includes(role as Role));
}

export function getTab(tabId: TabId): TabDef | undefined {
  return TABS.find((t) => t.id === tabId);
}

// Items del sidebar contextual para un tab + rol.
// Si el tab no existe o el rol no lo puede ver, retorna [].
export function getSidebarItems(tabId: TabId | null, role: string): NavItem[] {
  if (!tabId) return [];
  const tab = getTab(tabId);
  if (!tab || !tab.roles.includes(role as Role)) return [];
  return tab.items.filter((i) => i.roles.includes(role as Role));
}

// Items del BottomNav (mobile) para un tab + rol. Limitamos a 5 para que
// caben con touch target de 56px de ancho mínimo en pantallas de 360px.
export function getBottomNavItems(tabId: TabId | null, role: string): NavItem[] {
  const items = getSidebarItems(tabId, role);
  return items.slice(0, 5);
}

// Match exacto para el ítem activo dentro del sidebar.
// - Para "home del módulo" (/legal, /finanzas, /legal/admin) solo activamos
//   en match exacto, evitando que el dashboard quede pintado cuando navegás
//   a una subruta.
// - Para subrutas, activamos también si pathname empieza con href + "/".
export function isItemActive(itemHref: string, pathname: string): boolean {
  const isRootLike =
    itemHref === "/" ||
    itemHref === "/legal" ||
    itemHref === "/finanzas" ||
    itemHref === "/legal/admin";

  if (pathname === itemHref) return true;
  if (!isRootLike && pathname.startsWith(itemHref + "/")) return true;
  return false;
}
