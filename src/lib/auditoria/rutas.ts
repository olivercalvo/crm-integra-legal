/**
 * Las rutas de exportar y verificar de las dos bitácoras. Cada archivo de ruta
 * declara SUS roles (`const ROLES = [...]`, lo lee `nav-guard.test.ts`), verifica
 * el rol y pasa el contexto: el tenant y el usuario salen SIEMPRE del perfil.
 */
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generarXlsx, nombreDeArchivo } from "@/lib/finanzas/reports/exportar-xlsx";
import {
  describirFiltros,
  filtrosDesdeParams,
  hojaDeBitacora,
  leerBitacora,
  MAX_FILAS_EXPORT,
  verificarBitacora,
  type ModuloBitacora,
} from "@/lib/auditoria/bitacoras";
import { hoyEnPanama } from "@/lib/utils/hoy-en-panama";

export interface ContextoBitacora {
  db: SupabaseClient;
  tenantId: string;
  userId: string;
}

export async function exportarBitacora(request: NextRequest, modulo: ModuloBitacora, ctx: ContextoBitacora) {
  const sp = Object.fromEntries(new URL(request.url).searchParams.entries());
  const filtros = filtrosDesdeParams(modulo, sp);
  try {
    const { filas, total } = await leerBitacora(ctx.db, modulo, ctx.tenantId, ctx.userId, filtros, {
      limite: MAX_FILAS_EXPORT,
      offset: 0,
    });
    const nota = total > filas.length ? ` Se exportan las ${filas.length} más recientes de ${total}.` : "";
    const buffer = generarXlsx([hojaDeBitacora(modulo, filas, describirFiltros(modulo, filtros) + nota)]);
    const archivo = `${nombreDeArchivo(["Bitacora", modulo, hoyEnPanama()])}.xlsx`;
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${archivo}"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err) {
    console.error(`[auditoria] export ${modulo} falló:`, err);
    return NextResponse.json({ error: "No se pudo generar el Excel de la bitácora." }, { status: 500 });
  }
}

export async function verificarBitacoraRuta(modulo: ModuloBitacora, ctx: ContextoBitacora) {
  try {
    const resultado = await verificarBitacora(ctx.db, modulo, ctx.tenantId, ctx.userId);
    return NextResponse.json(resultado, { status: 200 });
  } catch (err) {
    console.error(`[auditoria] verificar ${modulo} falló:`, err);
    return NextResponse.json({ error: "No se pudo verificar la bitácora." }, { status: 500 });
  }
}
