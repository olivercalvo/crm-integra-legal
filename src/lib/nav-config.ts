import type { LucideIcon } from "lucide-react";
import {
  FileWarning,
  FileInput,
  FileMinus,
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
  HandCoins,
  Receipt,
  BarChart3,
  ShoppingBag,
  Truck,
  Scale,
  Wallet,
  BookOpenCheck,
  CalendarClock,
  Percent,
  SlidersHorizontal,
  CalendarCheck,
  TrendingUp,
  CheckSquare,
  BookOpen,
  CalendarDays,
  Clock,
  User,
  Landmark,
} from "lucide-react";

export type Role = "admin" | "abogada" | "asistente" | "contador";
export type TabId = "legal" | "finanzas" | "admin";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  roles: Role[];
  /** Grupo del menú (por ahora sólo Finanzas). Uno de `TabDef.groups`. */
  group?: string;
}

export interface TabDef {
  id: TabId;
  label: string;
  shortLabel: string;
  href: string;
  icon: LucideIcon;
  roles: Role[];
  /** Orden de los grupos del menú. Sin grupos, la lista va plana. */
  groups?: string[];
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
      // Gastos: fuera del alcance del asistente desde el 24/08/2026 (decisión de
      // negocio). El gate real está en el middleware — esto solo oculta el ítem.
      { label: "Gastos",         href: "/legal/gastos",     icon: DollarSign,      roles: ["admin", "abogada"] },
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
    // Requerimiento 44 (Josuarth, punto 14 de la revisión del 28/09): el menú
    // de Finanzas va POR PROCESO, en este orden de grupos. Sólo cambia el
    // grupo, el orden y la etiqueta: cada opción apunta a la misma ruta y con
    // los mismos roles que antes (el gate real sigue en route-access.ts).
    groups: ["Ventas", "Compras", "Asientos", "Reportes", "Configuración"],
    items: [
      // ── Ventas ──
      // Clientes vive en Legal (/legal/clientes): misma ruta, mismos roles. El
      // contador no la ve porque no entra a Legal.
      { group: "Ventas", label: "Clientes",          href: "/legal/clientes",                      icon: Users,       roles: ["admin", "abogada"] },
      { group: "Ventas", label: "Cotizaciones",      href: "/finanzas/cotizaciones",               icon: FileText,    roles: ["admin", "abogada"] },
      // Las notas de débito son facturas (077): salen en este listado.
      { group: "Ventas", label: "Facturación",       href: "/finanzas/facturas",                   icon: Receipt,     roles: ["admin", "abogada"] },
      // Notas de crédito como módulo propio (E8, 01/10/2026). Venta: emiten
      // admin y abogada, como las facturas. El contador sigue entrando sólo al
      // DETALLE (patrón en route-access.ts), no al listado ni al alta.
      { group: "Ventas", label: "Notas de crédito",  href: "/finanzas/notas-credito",              icon: FileMinus,   roles: ["admin", "abogada"] },
      // Cobros (recibos de caja, Bloque 2 — 21/09/2026). El contador entra
      // desde el mismo día por respuesta de Josuarth ("SÍ debe ver la pantalla
      // de Cobros"), en solo lectura: el patrón exacto está en
      // CONTADOR_FINANZAS_ALLOWED_PATTERNS de route-access.ts (el listado sí,
      // /nuevo no). Los dos se mueven juntos o nav-guard.test.ts falla.
      { group: "Ventas", label: "Cobros",            href: "/finanzas/cobros",                     icon: HandCoins,   roles: ["admin", "abogada", "contador"] },
      // Facturas emitidas fuera del CRM (092): admin y contador. Gate real en
      // ADMIN_CONTADOR_ONLY_PREFIXES de route-access.ts.
      { group: "Ventas", label: "Facturas externas (FAC-EXT)", href: "/finanzas/facturas-externas", icon: FileInput, roles: ["admin", "contador"] },
      // Pendientes de enviar a la DGI (03/10/2026): emitidos sin autorización.
      // Reintentan admin y abogada; el contador los ve (patrón exacto en
      // route-access.ts). Los dos se mueven juntos o nav-guard.test.ts falla.
      { group: "Ventas", label: "Pendientes DGI",    href: "/finanzas/pendientes-dgi",             icon: FileWarning, roles: ["admin", "abogada", "contador"] },

      // ── Compras ──
      { group: "Compras", label: "Proveedores",      href: "/finanzas/proveedores",                icon: Truck,       roles: ["admin", "abogada", "contador"] },
      { group: "Compras", label: "Compras", href: "/finanzas/gastos-bufete",              icon: ShoppingBag, roles: ["admin", "abogada", "contador"] },
      // NC de compra (E8): el contador tiene CRUD de compras, así que también
      // registra la NC del proveedor (prefijo en route-access.ts).
      { group: "Compras", label: "Notas de crédito de proveedor", href: "/finanzas/notas-credito-proveedor", icon: FileMinus, roles: ["admin", "abogada", "contador"] },

      // ── Asientos ──
      // Todo /finanzas/asientos es de admin y contador, la abogada NO. Un asiento
      // manual escribe directo en el libro sin documento que lo respalde, y si la
      // abogada no puede reclasificar una cuenta, menos puede esto. El gate real
      // está en ADMIN_CONTADOR_ONLY_PREFIXES; estas líneas solo esconden el botón,
      // y `nav-guard.test.ts` verifica que las dos digan lo mismo.
      { group: "Asientos", label: "Asientos de diario",       href: "/finanzas/asientos",                      icon: BookOpenCheck, roles: ["admin", "contador"] },
      { group: "Asientos", label: "Importación de asientos",  href: "/finanzas/asientos/importar",             icon: Upload,        roles: ["admin", "contador"] },
      { group: "Asientos", label: "Contabilizar documentos por mes", href: "/finanzas/asientos/documentos-existentes", icon: CalendarCheck, roles: ["admin", "contador"] },
      // Períodos: cerrar un mes impide asientos nuevos con esa fecha. El gate
      // real es ADMIN_CONTADOR_ONLY_PREFIXES; esta línea solo esconde el botón.
      { group: "Asientos", label: "Períodos contables",       href: "/finanzas/periodos",                      icon: CalendarClock, roles: ["admin", "contador"] },

      // ── Reportes ──
      // Cada reporte con su ruta de siempre; «Todos los reportes» es el hub.
      // «Ventas Mensuales» no va: es un marcador de lugar sin reporte detrás.
      { group: "Reportes", label: "Balance general",          href: "/finanzas/reportes/balance",       icon: Scale,        roles: ["admin", "abogada", "contador"] },
      { group: "Reportes", label: "Estado de resultado",      href: "/finanzas/reportes/pyl",           icon: TrendingUp,   roles: ["admin", "abogada", "contador"] },
      { group: "Reportes", label: "Balance de comprobación",  href: "/finanzas/reportes/comprobacion",  icon: CheckSquare,  roles: ["admin", "abogada", "contador"] },
      { group: "Reportes", label: "Libro mayor",              href: "/finanzas/reportes/mayor",         icon: BookOpen,     roles: ["admin", "abogada", "contador"] },
      { group: "Reportes", label: "Diario general",           href: "/finanzas/reportes/diario",        icon: CalendarDays, roles: ["admin", "abogada", "contador"] },
      { group: "Reportes", label: "Antigüedad de saldos",     href: "/finanzas/reportes/aging",         icon: Clock,        roles: ["admin", "abogada", "contador"] },
      { group: "Reportes", label: "Estado de cuenta",         href: "/finanzas/reportes/estado-cuenta", icon: User,         roles: ["admin", "abogada", "contador"] },
      { group: "Reportes", label: "Resumen de ITBMS",         href: "/finanzas/reportes/vat-summary",   icon: Percent,      roles: ["admin", "abogada", "contador"] },
      { group: "Reportes", label: "Todos los reportes",       href: "/finanzas/reportes",               icon: BarChart3,    roles: ["admin", "abogada", "contador"] },
      // Bitácora contable: admin y contador, solo lectura. Gate real en
      // ADMIN_CONTADOR_ONLY_PREFIXES.
      { group: "Reportes", label: "Bitácora contable",        href: "/finanzas/auditoria",              icon: FileText,     roles: ["admin", "contador"] },

      // ── Configuración ──
      { group: "Configuración", label: "Plan de cuentas",     href: "/finanzas/configuracion/cuentas",    icon: BookOpenCheck, roles: ["admin", "abogada", "contador"] },
      { group: "Configuración", label: "Impuestos",           href: "/finanzas/configuracion/impuestos",  icon: Percent,       roles: ["admin", "abogada", "contador"] },
      // La pantalla Apertura, en su ruta de siempre (admin y contador, por el
      // prefijo /finanzas/asientos).
      { group: "Configuración", label: "Saldos iniciales",    href: "/finanzas/asientos/apertura",        icon: Landmark,      roles: ["admin", "contador"] },
      // 096: el inicio contable. Leen los tres; editan admin y contador (la
      // pantalla y la ruta). Entra por el prefijo `/finanzas/configuracion`.
      { group: "Configuración", label: "Parámetros contables", href: "/finanzas/configuracion/parametros", icon: SlidersHorizontal, roles: ["admin", "abogada", "contador"] },
      { group: "Configuración", label: "Plantilla T&C",       href: "/finanzas/cotizaciones/configuracion", icon: Settings,   roles: ["admin"] },
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
      { label: "Bitácora Legal", href: "/legal/admin/auditoria",    icon: FileText, roles: ["admin"] },
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

/** Los ítems visibles del tab, por grupo (un solo bloque sin título si el tab no tiene grupos). */
export function getSidebarGroups(tabId: TabId | null, role: string): { group: string | null; items: NavItem[] }[] {
  const items = getSidebarItems(tabId, role);
  const tab = tabId ? getTab(tabId) : undefined;
  if (!tab?.groups) return items.length ? [{ group: null, items }] : [];
  return tab.groups
    .map((group) => ({ group, items: items.filter((i) => i.group === group) }))
    .filter((g) => g.items.length > 0);
}

/**
 * El ítem activo: el de href MÁS LARGO que coincide. `/finanzas/reportes/mayor`
 * coincide con «Todos los reportes» y con «Libro mayor», y
 * `/finanzas/asientos/apertura` con «Asientos de diario» y «Saldos iniciales»:
 * se pinta sólo el más específico.
 */
export function getActiveItemHref(items: NavItem[], pathname: string): string | null {
  let mejor: string | null = null;
  for (const i of items) {
    if (isItemActive(i.href, pathname) && (!mejor || i.href.length > mejor.length)) mejor = i.href;
  }
  return mejor;
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
