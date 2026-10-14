import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { rechazoSiPosteoHistoricoApagado } from "@/lib/finanzas/posteo-historico";

import { getAuthenticatedContext, requireRole } from "@/lib/supabase/server-query";
import { createAdminClient } from "@/lib/supabase/admin";
import { MutationError } from "@/lib/finanzas/api/errors";
import { conManejoDeAuditoria } from "@/lib/auditoria/error-de-auditoria";
import { corregirApertura, previsualizarCorreccion } from "@/lib/finanzas/api/apertura";

/**
 * POST /api/finanzas/asientos/apertura/corregir
 *   { mode: "preview" | "commit", aperturaId, filas, motivo?, hash? }
 *
 * preview («Revisar»): valida la tabla EN SECO con las mismas reglas del Excel
 * y devuelve errores por línea, el saldo por cuenta antes y después, el cuadre
 * al corte y lo que impide guardar. No escribe nada.
 * commit: la MISMA tabla que se revisó (hash) → corregir_apertura (102):
 * reversa la vigente y registra la corregida en UNA transacción.
 * Admin y contador (los de la apertura). El tenant sale del perfil.
 */
const ROLES = ["admin", "contador"] as const;

export const POST = conManejoDeAuditoria(async function POST(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, ROLES);
  if (denied) return denied;
  let body: { mode?: unknown; aperturaId?: unknown; filas?: unknown; motivo?: unknown; hash?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const aperturaId = typeof body.aperturaId === "string" ? body.aperturaId : "";
  if (!aperturaId) return NextResponse.json({ error: "Falta la apertura que se corrige." }, { status: 400 });
  try {
    if (body.mode === "preview") {
      const v = await previsualizarCorreccion(ctx.db, ctx.tenantId, aperturaId, body.filas);
      return NextResponse.json({
        hash: v.hash,
        fecha: v.fecha,
        errores: v.resultado.errores,
        lineas: v.resultado.lineas.length,
        totalDebitos: v.resultado.totalDebitos,
        totalCreditos: v.resultado.totalCreditos,
        porCuenta: v.resultado.porCuenta,
        cambios: v.cambios,
        cuadre: v.cuadre,
        bloqueos: v.bloqueos,
      });
    }
    if (body.mode === "commit") {
      // Interruptor (07/10): apagado, revisar sí, guardar no (403).
      const apagado = rechazoSiPosteoHistoricoApagado();
      if (apagado) return apagado;
      const r = await corregirApertura(ctx.db, createAdminClient(ctx.userId), ctx.tenantId, ctx.userId, aperturaId,
        body.filas, body.motivo, typeof body.hash === "string" ? body.hash : "");
      return NextResponse.json(r, { status: 201 });
    }
    return NextResponse.json({ error: "Modo inválido (preview | commit)" }, { status: 400 });
  } catch (err) {
    if (err instanceof MutationError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
});
