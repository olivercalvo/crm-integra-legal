/**
 * ⚠️ DESDE EL BLOQUE 4 (21/09/2026) ESTA RUTA ES UN REINTENTO, NO EL CAMINO.
 * El gasto se postea AUTOMÁTICAMENTE al crearse (`POST /api/expenses`): registrar
 * el gasto YA es la transacción (Josuarth: débito 130003 / crédito cuentas por
 * pagar). Esta ruta queda para los gastos ANTERIORES al cambio, que nacieron sin
 * asiento y cuyas líneas hay que clasificar primero. Un gasto nuevo nunca llega
 * acá: nace con `posted_entry_id` y la capa 1 lo rechaza con 409.
 * La lógica es UNA (`postearGastoTramite`), compartida con el alta.
 *
 * POST /api/expenses/[id]/post-to-ledger
 *
 * Registra un gasto de trámite en el libro contable.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ES LA PRIMERA RUTA DE `/api` QUE ESCRIBE EN EL LEDGER
 * ═════════════════════════════════════════════════════════════════════════════
 * Hasta hoy `postJournalEntry()` solo se llamaba desde su propia definición y
 * desde `scripts/backfill-asientos-faltantes.mts`; los asientos de staging los
 * puso `scripts/seed-asientos.ts`. **Este archivo es el patrón que van a copiar
 * factura, cobro y compra**, así que cada decisión de acá vale por cuatro.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SOP-014, PUNTO POR PUNTO
 * ─────────────────────────────────────────────────────────────────────────────
 *   · **Server-side.** Es un route handler. `postJournalEntry` no se importa
 *     nunca desde un client component.
 *   · **Cliente de servicio.** `createAdminClient()`. Desde la migración `030` el
 *     RPC tiene `EXECUTE` solo para `service_role`: no es llamable desde la
 *     sesión del usuario.
 *   · **`tenant_id` del PERFIL, nunca del body.** Se lee de `users` con el id del
 *     usuario autenticado. Un `tenant_id` en el cuerpo sería un intento de
 *     escribir en el ledger de otro bufete — y como el RPC es `SECURITY DEFINER`
 *     y **dejó de correr bajo RLS**, la ruta es la única que lo valida.
 *   · **Solo por `post_journal_entry`.** Cero INSERT directo a `journal_entries`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 UN GASTO CON LÍNEAS SIN CLASIFICAR NO SE POSTEA
 * ─────────────────────────────────────────────────────────────────────────────
 * Lo decide `construirAsientoDeGastoTramite()`, que devuelve un resultado
 * discriminado en vez de lanzar: el compilador obliga a manejar el caso.
 *
 * **Ese rechazo es la razón por la que el NULL vale la pena.** Sin él, el NULL de
 * los 128 gastos históricos sería solo una columna vacía; con él es lo que impide
 * que un gasto que nadie clasificó entre al libro contra una cuenta inventada.
 * Y el libro no se puede corregir después: los asientos son inmutables.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IDEMPOTENCIA EN TRES CAPAS
 * ─────────────────────────────────────────────────────────────────────────────
 * Un asiento duplicado en un libro inmutable NO SE BORRA. La única salida sería
 * un asiento de reversión que un contador tiene que justificar ante la DGI.
 *
 *   1. **`expenses.posted_entry_id`** — corta temprano, sin pegarle al ledger.
 *      Es un CACHE: puede estar desactualizado, por eso no es la garantía.
 *   2. **`SELECT` sobre `journal_entries`** — la verdad, y da el mensaje
 *      entendible con el número de asiento.
 *   3. **El UNIQUE parcial de la `034`** `(tenant_id, source_type, source_id)` —
 *      LA GARANTÍA. Las dos primeras dejan una ventana entre el SELECT y el
 *      INSERT: dos requests simultáneos —un doble clic, un retry— la pasan las
 *      dos. Solo el índice no depende del timing.
 *
 * El `23505` del índice se traduce al MISMO mensaje de la capa 2: para quien
 * aprieta el botón dos veces, las dos rutas tienen que contar lo mismo.
 */

import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/supabase/server-query";
import { MutationError } from "@/lib/finanzas/api/errors";
import { postearGastoTramite } from "@/lib/finanzas/api/expense-tramite";

/**
 * Quién puede REGISTRAR el gasto en el libro. Coincide con `EXPENSE_WRITE_ROLES`
 * de `POST /api/expenses`: el que crea gastos es el que puede reintentar su
 * posteo. El contador lee la pantalla, no la registra.
 */
const EXPENSE_WRITE_ROLES = ["admin", "abogada"] as const;

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
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

    const denied = requireRole(profile.role, EXPENSE_WRITE_ROLES);
    if (denied) return denied;

    // 🔑 El tenant sale de ACÁ. El body de esta ruta no se lee: no hay ni un
    // dato del request que entre al asiento.
    const tenantId = profile.tenant_id as string;

    try {
      const posteo = await postearGastoTramite(admin, tenantId, params.id, user.id);
      return NextResponse.json(posteo, { status: 201 });
    } catch (err) {
      if (err instanceof MutationError) {
        const extra =
          err.detail && typeof err.detail === "object" && "motivo" in (err.detail as object)
            ? (err.detail as { motivo: string; lineas: number[] })
            : {};
        return NextResponse.json({ error: err.message, ...extra }, { status: err.status });
      }
      throw err;
    }
  } catch (err) {
    console.error("[expenses/post-to-ledger] unexpected", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
