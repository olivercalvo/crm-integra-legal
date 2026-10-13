import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { rechazoSiPosteoHistoricoApagado } from "@/lib/finanzas/posteo-historico";

import { getAuthenticatedContext, requireRole } from "@/lib/supabase/server-query";
import { createAdminClient } from "@/lib/supabase/admin";
import { MutationError } from "@/lib/finanzas/api/errors";
import { conManejoDeAuditoria } from "@/lib/auditoria/error-de-auditoria";
import { contabilizarApertura, previsualizarApertura } from "@/lib/finanzas/api/apertura";
import { WorkbookDeAperturaError } from "@/lib/finanzas/import/apertura-workbook";
import { FORMATO_DE_FECHA_POR_DEFECTO, esFormatoDeFecha } from "@/lib/finanzas/import/asientos-import";

export const runtime = "nodejs";

/**
 * POST /api/finanzas/asientos/apertura (multipart: file, mode = preview | commit, hash, date_format = MM/DD | DD/MM)
 *
 * preview: valida la plantilla EN SECO (no escribe nada) y devuelve errores por
 * fila, totales por cuenta, el cuadre al corte y lo que impide contabilizar.
 * commit: el MISMO archivo de la vista previa (hash) → post_apertura (100), en
 * una transacción. Lo aprieta una persona. Admin y contador (los de asientos).
 * El tenant sale del perfil; el libro, con el usuario en x-actor-id.
 */
const ROLES = ["admin", "contador"] as const;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const POST = conManejoDeAuditoria(async function POST(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, ROLES);
  if (denied) return denied;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Se esperaba un archivo" }, { status: 400 });
  }
  const mode = String(form.get("mode") ?? "preview");
  // Como en la importación de asientos: MM/DD (por defecto) o DD/MM para una
  // fecha escrita como texto. Otro valor se rechaza: adivinar fecharía mal.
  const formatoRaw = form.get("date_format");
  const formato = formatoRaw === null ? FORMATO_DE_FECHA_POR_DEFECTO : String(formatoRaw);
  if (!esFormatoDeFecha(formato)) {
    return NextResponse.json({ error: "Elige el formato de fecha del archivo: MM/DD o DD/MM." }, { status: 400 });
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "El archivo está vacío" }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "El archivo supera los 5 MB permitidos" }, { status: 400 });
  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    if (mode === "preview") {
      const v = await previsualizarApertura(ctx.db, ctx.tenantId, buffer, formato);
      return NextResponse.json({
        hash: v.hash,
        fecha: v.fecha,
        errores: v.resultado.errores,
        lineas: v.resultado.lineas.length,
        totalDebitos: v.resultado.totalDebitos,
        totalCreditos: v.resultado.totalCreditos,
        porCuenta: v.resultado.porCuenta,
        cuadre: v.cuadre,
        bloqueos: v.bloqueos,
      });
    }
    if (mode === "commit") {
      // Interruptor (07/10): apagado, revisar en seco sí, contabilizar no (403).
      const apagado = rechazoSiPosteoHistoricoApagado();
      if (apagado) return apagado;
      const r = await contabilizarApertura(ctx.db, createAdminClient(ctx.userId), ctx.tenantId, ctx.userId, buffer, file.name,
        String(form.get("hash") ?? ""), formato);
      return NextResponse.json(r, { status: 201 });
    }
    return NextResponse.json({ error: "Modo inválido (preview | commit)" }, { status: 400 });
  } catch (err) {
    if (err instanceof WorkbookDeAperturaError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof MutationError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
});
