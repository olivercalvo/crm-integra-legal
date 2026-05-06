import { redirect } from "next/navigation";

/**
 * Hoy `/finanzas` redirige a Facturas (única vista del módulo en MVP). Cuando
 * exista un dashboard propio de Finanzas (cobros pendientes, aging, etc.),
 * reemplazar este redirect por el componente del dashboard.
 */
export default function FinanzasIndexPage() {
  redirect("/finanzas/facturas");
}
