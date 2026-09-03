/**
 * GET /api/expenses/[id]/receipt/download
 *
 * El comprobante de un gasto de trámite, servido POR EL DOMINIO DE LA APP.
 * Reemplaza a `/receipt/url`, que entregaba un enlace firmado directo a
 * `*.supabase.co`. Ver `src/lib/storage/serve-file.ts`.
 *
 * PERMISOS: sesión + mismo tenant, y CUALQUIER rol de los cuatro.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL CONTADOR ENTRA ACÁ DESDE EL 03/09/2026 (antes tenía un 403 explícito)
 * ─────────────────────────────────────────────────────────────────────────────
 * El comentario original decía "el gasto de trámite es del módulo legal, así que
 * el contador —que no entra ahí— queda fuera", y era correcto mientras el
 * contador no tuviera forma de llegar a un gasto de trámite.
 *
 * Dejó de serlo con `/finanzas/gastos-tramite/{id}`: cuando el cableado
 * documento→asiento exista, el Libro Mayor va a enlazar el asiento de un gasto
 * de trámite a esa pantalla, y auditar un asiento ES poder ver su comprobante —
 * la guía de RM lo pide en su lista de validación. Un 403 acá dejaría la
 * pantalla con un botón de descarga que falla al apretarlo.
 *
 * ⚠️ **Esto amplía el acceso del contador a UN archivo, no al expediente.** Es
 * el comprobante del gasto: una factura o un recibo de un proveedor, que es
 * material contable. El contenido legal del caso sigue cerrado, y lo fija
 * `gastos-tramite-privacidad.test.ts`.
 */
import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serveStorageFile } from "@/lib/storage/serve-file";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("users")
      .select("tenant_id, role")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });
    }
    // Sin gate por rol: los cuatro roles pueden bajar el comprobante de un gasto
    // de trámite. El aislamiento real es el `.eq("tenant_id", ...)` de abajo.
    // Ver la nota del encabezado sobre por qué el contador dejó de tener un 403.

    const { data: expense } = await admin
      .from("expenses")
      .select("receipt_url, receipt_filename")
      .eq("id", params.id)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (!expense?.receipt_url) {
      return NextResponse.json({ error: "Recibo no encontrado" }, { status: 404 });
    }

    return await serveStorageFile({
      admin,
      bucket: "documents",
      storageKey: expense.receipt_url,
      fileName: expense.receipt_filename ?? "comprobante",
    });
  } catch (err) {
    console.error("[expenses/receipt/download] error", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
