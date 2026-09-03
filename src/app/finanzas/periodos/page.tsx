import { redirect } from "next/navigation";
import { CalendarClock } from "lucide-react";

import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { listarPeriodos } from "@/lib/finanzas/queries/periodos";
import { PeriodosManager } from "./_components/periodos-manager";

/**
 * PERÍODOS CONTABLES — cierre y reapertura.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ESTA PANTALLA NO CONSTRUYE EL BLOQUEO: LO OPERA
 * ═════════════════════════════════════════════════════════════════════════════
 * `accounting_periods` existe desde la migración `023`, y `post_journal_entry`
 * rechaza desde la `030` todo asiento cuya fecha caiga en un período `cerrado`.
 * Las dos cosas llevaban días funcionando.
 *
 * Lo único que faltaba —y es todo lo que agrega este bloque— era **poder cerrar
 * un período desde la aplicación**. Hasta hoy la única forma era un `UPDATE` a
 * mano en el SQL Editor de Supabase, o sea: el cierre contable dependía de que
 * alguien con la contraseña de la base lo hiciera por afuera del sistema.
 *
 * ⚠️ Por eso acá no hay ninguna validación de fechas. El motor ya la hace, en la
 * base, y duplicarla crearía dos verdades.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔒 ADMIN Y CONTADOR. LA ABOGADA NO.
 * ─────────────────────────────────────────────────────────────────────────────
 * Segundo caso de una ruta de `/finanzas` cerrada a la abogada, después de los
 * asientos manuales, y por el mismo criterio: decidir qué ejercicio admite
 * movimientos es una atribución de cierre contable. Sale por
 * `ADMIN_CONTADOR_ONLY_PREFIXES` en `route-access.ts`; el `redirect` de abajo es
 * defensa en profundidad.
 */

export const metadata = {
  title: "Períodos Contables · Finanzas",
};

/** Tiene que coincidir con `ADMIN_CONTADOR_ONLY_PREFIXES` y con la ruta de API. */
const ROLES = ["admin", "contador"];

export default async function PeriodosPage() {
  const ctx = await getAuthenticatedContext();
  if (!ROLES.includes(ctx.userRole)) {
    redirect("/finanzas");
  }

  const periodos = await listarPeriodos(ctx.db, ctx.tenantId);

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <CalendarClock size={22} className="text-integra-gold" />
          <h1 className="font-serif text-2xl text-integra-navy">Períodos Contables</h1>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Cerrar un mes impide que entren asientos nuevos con esa fecha. El sistema lo hace
          cumplir al registrar, no solo en pantalla.
        </p>
      </div>

      {periodos.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Todavía no hay períodos contables. Se crean solos al registrar el primer asiento del
          año.
        </div>
      ) : (
        <PeriodosManager periodos={periodos} />
      )}
    </div>
  );
}
