import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedContext, requireRole } from "@/lib/supabase/server-query";
import { contabilizarImportacion, previsualizarImportacion } from "@/lib/finanzas/api/importacion-asientos";
import { WorkbookDeAsientosError } from "@/lib/finanzas/import/asientos-workbook";
import { MutationError } from "@/lib/finanzas/api/errors";

export const runtime = "nodejs";

/**
 * POST /api/finanzas/asientos/importar   (multipart: file, mode, hash)
 *
 * `mode=preview`: lee y valida TODO; no escribe nada. Devuelve los asientos,
 * los errores por fila y el hash del archivo.
 * `mode=commit`: vuelve a leer el archivo, exige el hash de la vista previa y
 * contabiliza el lote en UNA transacción (067). Todo o nada.
 *
 * Roles: admin y contador, los mismos que el asiento manual (la abogada no).
 */
const ROLES_ASIENTO_MANUAL = ["admin", "contador"] as const;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, ROLES_ASIENTO_MANUAL);
  if (denied) return denied;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Se esperaba un archivo" }, { status: 400 });
  }
  const mode = String(form.get("mode") ?? "preview");
  const file = form.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "El archivo está vacío" }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "El archivo supera los 5 MB permitidos" }, { status: 400 });
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    if (mode === "preview") {
      const r = await previsualizarImportacion(ctx.db, ctx.tenantId, buffer);
      return NextResponse.json(r);
    }
    if (mode === "commit") {
      const hash = String(form.get("hash") ?? "");
      const r = await contabilizarImportacion(ctx.db, createAdminClient(), ctx.tenantId, ctx.userId, buffer, file.name, hash);
      return NextResponse.json(r, { status: 201 });
    }
    return NextResponse.json({ error: "Modo inválido (preview | commit)" }, { status: 400 });
  } catch (err) {
    if (err instanceof WorkbookDeAsientosError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof MutationError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[finanzas] importar asientos unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
