import { redirect } from "next/navigation";
import Link from "next/link";
import { BookOpenCheck, CalendarDays } from "lucide-react";

import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { listChartAccounts } from "@/lib/finanzas/queries/chart-of-accounts";
import { AsientoManualForm } from "./_components/asiento-manual-form";

/**
 * ASIENTOS DE DIARIO — la pantalla de carga manual.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUÉ NO HAY LISTADO ACÁ
 * ═════════════════════════════════════════════════════════════════════════════
 * El listado de asientos **ya existe**: es el Diario General
 * (`/finanzas/reportes/diario`), que los muestra todos en orden cronológico con
 * sus líneas, y es donde un contador los busca. Construir un segundo listado sería
 * una pantalla que dice lo mismo y que hay que mantener sincronizada.
 *
 * Así que esta ruta es el FORMULARIO, y enlaza al Diario para ver el resultado.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔒 ADMIN Y CONTADOR. LA ABOGADA NO.
 * ─────────────────────────────────────────────────────────────────────────────
 * Es el primer caso de una ruta de `/finanzas` cerrada a la abogada, y por eso
 * necesitó `ADMIN_CONTADOR_ONLY_PREFIXES` en `route-access.ts` — su
 * `ROLE_ROUTES` le abre todo `/finanzas`.
 *
 * El criterio: `updateChartAccount()` ya reserva a admin y contador la
 * reclasificación contable de una cuenta, con la regla textual de la guía de RM.
 * Un asiento manual es más sensible todavía — escribe directo en el libro **sin
 * ningún documento que lo respalde**, y lo escrito es inmutable. Si la abogada no
 * puede lo menos, no puede lo más.
 *
 * El `redirect` de abajo es defensa en profundidad: el middleware ya la rebota.
 */

export const metadata = {
  title: "Asientos de Diario · Finanzas",
};

/** Tiene que coincidir con `ADMIN_CONTADOR_ONLY_PREFIXES` y con la ruta de API. */
const ROLES = ["admin", "contador"];

export default async function AsientosPage() {
  const ctx = await getAuthenticatedContext();
  if (!ROLES.includes(ctx.userRole)) {
    redirect("/finanzas");
  }

  // ⚠️ TODAS las cuentas activas, sin lista corta y sin filtro por tipo.
  //
  // Un asiento manual es el mecanismo para tocar lo que ningún documento toca: el
  // aporte de capital va contra patrimonio, un ajuste de ingresos diferidos contra
  // ingreso. Acá NO se usa `cuentasSugeridasParaTramite()` ni
  // `esTipoValidoParaGasto()`: sería un guard correcto en el módulo equivocado.
  // Ver `contabilidad/asiento-manual.ts` y sop.md SOP-024.
  //
  // El único filtro es `active`, el mismo que hace cumplir el RPC.
  const cuentas = (await listChartAccounts(ctx.db, ctx.tenantId))
    .filter((c) => c.active)
    .map((c) => ({ code: c.code, name: c.name }));

  // La fecha se calcula en el SERVIDOR: el reloj del navegador puede estar en otra
  // zona horaria y un asiento cargado a las 22:00 en Panamá caería en el día
  // siguiente — o sea, en otro período contable si es fin de mes.
  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BookOpenCheck size={22} className="text-integra-gold" />
            <h1 className="font-serif text-2xl text-integra-navy">Asiento de Diario</h1>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Para ajustes, depreciaciones, provisiones y aportes: lo que no sale de una
            factura ni de un gasto.
          </p>
        </div>

        {/* nav-guard-ok: /finanzas/reportes lo ven admin, abogada y contador, y
            esta pantalla solo la abren admin y contador. */}
        <Link
          href="/finanzas/reportes/diario"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-600 hover:border-integra-navy hover:text-integra-navy"
        >
          <CalendarDays size={16} />
          Ver los asientos registrados
        </Link>
      </div>

      {cuentas.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          No hay cuentas activas en el plan. Cargá el plan de cuentas antes de registrar
          asientos.
        </div>
      ) : (
        <AsientoManualForm cuentas={cuentas} hoy={hoy} />
      )}
    </div>
  );
}
