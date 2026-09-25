import { redirect } from "next/navigation";
import Link from "next/link";
import { BookOpenCheck, CalendarDays, FileSpreadsheet, History } from "lucide-react";

import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { listChartAccounts } from "@/lib/finanzas/queries/chart-of-accounts";
import { listTercerosDelLibro } from "@/lib/finanzas/queries/terceros-del-libro";
import { getAsientoDelLibro } from "@/lib/finanzas/queries/asiento-manual";
import {
  borradoresDesdeAsiento,
  MAX_LINEAS_MANUALES,
  type LineaManualDraft,
} from "@/lib/finanzas/contabilidad/asiento-manual";
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

export default async function AsientosPage({
  searchParams,
}: {
  searchParams?: { clonar?: string };
}) {
  const ctx = await getAuthenticatedContext();
  if (!ROLES.includes(ctx.userRole)) {
    redirect("/finanzas");
  }

  // CLONAR (7.4, D7): `?clonar=<id>` precarga el formulario con las líneas de
  // un asiento que ya está en el libro — montos y descripciones incluidos.
  //
  // Solo asientos MANUALES: clonar el de una factura fabricaría a mano un
  // asiento que su documento va a volver a generar. Y solo hasta el tope del
  // formulario: un asiento de 200 líneas entró por el importador, que no pasa
  // por esta pantalla (D9).
  let plantilla: LineaManualDraft[] | null = null;
  let clonadoDe: number | null = null;
  let descripcionClonada = "";
  let referenciaClonada = "";
  let avisoDelClon: string | null = null;
  if (searchParams?.clonar) {
    const origen = await getAsientoDelLibro(ctx.db, ctx.tenantId, searchParams.clonar);
    if (!origen) {
      avisoDelClon = "No se encontró el asiento que se quería clonar.";
    } else if (origen.source_type !== "manual") {
      avisoDelClon =
        `El asiento ${origen.entry_number} salió de un documento, no de una carga manual: ` +
        "no se clona desde acá. El documento genera el suyo.";
    } else if (origen.lineas.length > MAX_LINEAS_MANUALES) {
      avisoDelClon =
        `El asiento ${origen.entry_number} tiene ${origen.lineas.length} líneas y este formulario ` +
        `admite ${MAX_LINEAS_MANUALES}. Se cargó por otra vía y por ahí se vuelve a cargar.`;
    } else {
      plantilla = borradoresDesdeAsiento(origen.lineas);
      clonadoDe = origen.entry_number;
      descripcionClonada = origen.description;
      referenciaClonada = origen.reference ?? "";
    }
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

  // Los terceros que una línea puede nombrar (054). Clientes y proveedores en
  // una sola consulta cada uno: la lista se arma una vez y la comparten las N
  // líneas del formulario.
  const terceros = await listTercerosDelLibro(ctx.db, ctx.tenantId);

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
        {/* 7.5: importar desde Excel. Mismas rutas bajo /finanzas/asientos, que
            sólo abren admin y contador (ADMIN_CONTADOR_ONLY_PREFIXES). */}
        <div className="flex flex-wrap gap-2">
          <Link
            href="/finanzas/asientos/importar"
            className="inline-flex min-h-[48px] items-center gap-2 rounded-md bg-integra-navy px-4 text-sm font-semibold text-white hover:bg-integra-navy/90"
          >
            <FileSpreadsheet size={16} />
            Importar desde Excel
          </Link>
          <Link
            href="/finanzas/asientos/importaciones"
            className="inline-flex min-h-[48px] items-center gap-2 rounded-md border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-600 hover:border-integra-navy hover:text-integra-navy"
          >
            <History size={16} />
            Ver importaciones
          </Link>
        </div>
      </div>

      {avisoDelClon && (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          {avisoDelClon}
        </div>
      )}

      {cuentas.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          No hay cuentas activas en el plan. Cargue el plan de cuentas antes de registrar
          asientos.
        </div>
      ) : (
        <AsientoManualForm
          cuentas={cuentas}
          terceros={terceros}
          hoy={hoy}
          plantilla={plantilla}
          clonadoDe={clonadoDe}
          descripcionInicial={descripcionClonada}
          referenciaInicial={referenciaClonada}
        />
      )}
    </div>
  );
}
