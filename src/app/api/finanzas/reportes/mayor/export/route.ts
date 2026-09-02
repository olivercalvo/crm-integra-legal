import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import {
  loadCuentaDelMayor,
  loadCuentasControl,
  loadMovimientosDeCuenta,
} from "@/lib/finanzas/reports/libro-mayor-source";
import { buildMayorDeCuenta } from "@/lib/finanzas/reports/libro-mayor";
import { resolverTercerosFiscales } from "@/lib/finanzas/reports/tercero-fiscal";
import { hojaDelMayor } from "@/lib/finanzas/reports/mayor-export";
import { generarXlsx, nombreDeArchivo } from "@/lib/finanzas/reports/exportar-xlsx";
import { REPORT_FIRM_NAME, formatGeneratedAt } from "@/app/finanzas/reportes/_components/report-meta";

/**
 * GET /api/finanzas/reportes/mayor/export?cuenta=CODE&desde=&hasta=
 *
 * Descarga el Libro Mayor de una cuenta en Excel, con el RUC y el DV del tercero
 * en columnas separadas.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔒 LA EXPORTACIÓN NO PUEDE SER UNA PUERTA LATERAL
 * ─────────────────────────────────────────────────────────────────────────────
 * Un endpoint que devuelve un archivo es tan sensible como la pantalla que lo
 * origina, y más fácil de olvidar. Tres candados, y los tres importan:
 *
 *   1. **El rol se verifica acá**, con la misma lista que la pantalla del mayor
 *      (`/finanzas/reportes/*`): admin, abogada y contador. El asistente ya
 *      queda fuera de /finanzas por middleware; se rechaza igual, que es la
 *      regla de defensa en profundidad del repo.
 *   2. **El `tenant_id` sale del perfil autenticado, NUNCA del request.** No hay
 *      forma de pedir el mayor de otro bufete: no existe el parámetro.
 *   3. **Se exporta exactamente lo que la pantalla arma**, con los mismos
 *      loaders y el mismo builder. No hay una consulta paralela que pueda traer
 *      de más — que es justamente como una exportación se convierte en un
 *      agujero.
 */
export const runtime = "nodejs";

const ROLES = ["admin", "abogada", "contador"] as const;

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  if (!ROLES.includes(ctx.userRole as (typeof ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const sp = new URL(request.url).searchParams;
  const code = sp.get("cuenta")?.trim() ?? "";
  const desdeRaw = sp.get("desde")?.trim() ?? "";
  const hastaRaw = sp.get("hasta")?.trim() ?? "";

  if (!code) {
    return NextResponse.json({ error: "Falta el parámetro 'cuenta'" }, { status: 400 });
  }
  // Un rango mal formado se ignora en vez de reventar, igual que en la pantalla.
  const desde = FECHA_RE.test(desdeRaw) ? desdeRaw : "";
  const hasta = FECHA_RE.test(hastaRaw) ? hastaRaw : "";

  try {
    // `loadCuentaDelMayor` filtra por tenant: una cuenta de otro bufete da null,
    // y eso sale como 404, no como un archivo vacío.
    const cuenta = await loadCuentaDelMayor(ctx.db, ctx.tenantId, code, { desde, hasta });
    if (!cuenta) {
      return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
    }

    const [movimientos, control] = await Promise.all([
      loadMovimientosDeCuenta(ctx.db, ctx.tenantId, code, { desde, hasta }),
      loadCuentasControl(ctx.db, ctx.tenantId),
    ]);

    const mayor = buildMayorDeCuenta(cuenta, movimientos, { controlPorCodigo: control });

    const terceros = await resolverTercerosFiscales(
      ctx.db,
      ctx.tenantId,
      movimientos.map((m) => ({
        entry_id: m.entry_id,
        source_type: m.source_type,
        source_id: m.source_id,
      }))
    );

    const buffer = generarXlsx([
      hojaDelMayor(mayor, terceros, {
        bufete: REPORT_FIRM_NAME,
        generadoEl: formatGeneratedAt(),
        desde: desde || null,
        hasta: hasta || null,
      }),
    ]);

    const filename = `${nombreDeArchivo([
      "Mayor",
      cuenta.code,
      cuenta.name,
      desde || null,
      hasta || null,
    ])}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err) {
    console.error("[finanzas] export del mayor falló:", err);
    return NextResponse.json({ error: "Error al generar el archivo" }, { status: 500 });
  }
}
