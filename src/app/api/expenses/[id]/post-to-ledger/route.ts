/**
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
import { postJournalEntry } from "@/lib/finanzas/contabilidad/posting";
import { MutationError } from "@/lib/finanzas/api/errors";
import {
  construirAsientoDeGastoTramite,
  SOURCE_TYPE_GASTO_TRAMITE,
} from "@/lib/finanzas/contabilidad/asiento-gasto-tramite";
import { getLineasDeGastoTramite } from "@/lib/finanzas/queries/expense-tramite";

export const runtime = "nodejs";

/** Mismo gate que `/legal/gastos` y que `POST /api/expenses`. */
const EXPENSE_WRITE_ROLES = ["admin", "abogada"] as const;

/** El mensaje de "ya está posteado", en UN solo lugar: lo usan las capas 2 y 3. */
function yaPosteado(numero: number | null): string {
  return numero === null
    ? "Este gasto ya está registrado en el libro contable."
    : `Este gasto ya está registrado en el libro contable (asiento ${numero}).`;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
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

    const denied = requireRole(profile.role, EXPENSE_WRITE_ROLES);
    if (denied) return denied;

    // 🔑 El tenant sale de ACÁ. El body de esta ruta no se lee: no hay ni un
    // dato del request que entre al asiento.
    const tenantId = profile.tenant_id as string;

    // ── El gasto ────────────────────────────────────────────────────────────
    const { data: gasto, error: errGasto } = await admin
      .from("expenses")
      .select(
        `id, date, concept, posted_entry_id,
         cases(case_code),
         suppliers(legal_name)`
      )
      .eq("id", params.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (errGasto) {
      console.error("[expenses/post-to-ledger] lookup failed", errGasto);
      return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
    if (!gasto) {
      return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });
    }

    // ── CAPA 1: el cache ────────────────────────────────────────────────────
    if (gasto.posted_entry_id) {
      const { data: ya } = await admin
        .from("journal_entries")
        .select("entry_number")
        .eq("id", gasto.posted_entry_id)
        .maybeSingle();
      return NextResponse.json(
        { error: yaPosteado((ya as { entry_number: number } | null)?.entry_number ?? null) },
        { status: 409 }
      );
    }

    // ── CAPA 2: la verdad ───────────────────────────────────────────────────
    const { data: asientoPrevio, error: errPrevio } = await admin
      .from("journal_entries")
      .select("entry_number")
      .eq("tenant_id", tenantId)
      .eq("source_type", SOURCE_TYPE_GASTO_TRAMITE)
      .eq("source_id", params.id)
      .maybeSingle();

    if (errPrevio) {
      // Ante la duda NO se asume que no hay asiento: postear de más es lo único
      // que no se puede deshacer. Mismo criterio que `contarMovimientos()`.
      console.error("[expenses/post-to-ledger] asiento lookup failed", errPrevio);
      return NextResponse.json(
        { error: "No se pudo verificar si el gasto ya está en el libro. No se registró nada." },
        { status: 500 }
      );
    }
    if (asientoPrevio) {
      return NextResponse.json(
        { error: yaPosteado((asientoPrevio as { entry_number: number }).entry_number) },
        { status: 409 }
      );
    }

    // ── Las líneas y el armado ──────────────────────────────────────────────
    const lineas = await getLineasDeGastoTramite(admin, tenantId, params.id);

    const caso = (gasto as unknown as { cases: { case_code: string } | null }).cases;
    const prov = (gasto as unknown as { suppliers: { legal_name: string } | null }).suppliers;

    const armado = construirAsientoDeGastoTramite(
      {
        id: String(gasto.id),
        date: String(gasto.date),
        concept: String(gasto.concept ?? ""),
        case_code: caso?.case_code ?? null,
        supplier_legal_name: prov?.legal_name ?? null,
      },
      lineas
    );

    if (!armado.ok) {
      // 🔴 Acá cae el rechazo por líneas sin clasificar, con su mensaje ya
      // redactado y los números de línea adentro. 422 y no 400: el request está
      // bien formado, lo que falta es que alguien clasifique.
      return NextResponse.json(
        { error: armado.mensaje, motivo: armado.motivo, lineas: armado.lineasSinCuenta },
        { status: 422 }
      );
    }

    // ── EL POSTEO ───────────────────────────────────────────────────────────
    let entryId: string;
    try {
      entryId = await postJournalEntry(admin, tenantId, armado.asiento, user.id);
    } catch (err) {
      // ── CAPA 3: el UNIQUE de la 034 ──────────────────────────────────────
      // Es el caso del doble clic: dos requests pasaron la capa 2 a la vez y el
      // índice frenó al segundo. Se traduce al MISMO mensaje, no a un error de
      // constraint.
      //
      // ⚠️ El código de Postgres viaja en `MutationError.detail`, NO en `cause`.
      // `postJournalEntry()` hace `new MutationError(msg, 422, error)` y el
      // tercer argumento del constructor es `detail` (ver `api/errors.ts`).
      // La primera versión de este bloque miraba `cause` y devolvía 422 en vez
      // de 409: el doble clic contestaba "el asiento está mal armado" cuando en
      // realidad ya estaba posteado. Lo encontró el test de la capa 3.
      const codigo =
        (err as MutationError)?.detail &&
        typeof (err as MutationError).detail === "object"
          ? ((err as MutationError).detail as { code?: string }).code
          : (err as { code?: string })?.code;

      if (codigo === "23505") {
        const { data: ganador } = await admin
          .from("journal_entries")
          .select("entry_number")
          .eq("tenant_id", tenantId)
          .eq("source_type", SOURCE_TYPE_GASTO_TRAMITE)
          .eq("source_id", params.id)
          .maybeSingle();
        return NextResponse.json(
          { error: yaPosteado((ganador as { entry_number: number } | null)?.entry_number ?? null) },
          { status: 409 }
        );
      }
      if (err instanceof MutationError) {
        // Los mensajes del RPC ya vienen redactados en español desde la `028`
        // (período cerrado, cuenta inexistente, asiento descuadrado).
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }

    // ── El cache. Si falla, NO se falla el request ───────────────────────────
    // El asiento ya está en el libro y eso es lo irreversible. `posted_entry_id`
    // es una optimización de lectura: la verdad la lee `getNumeroDeAsiento()`
    // contra `journal_entries`, así que la pantalla sigue estando bien. Devolver
    // un error acá haría que alguien reintente un posteo que YA se hizo.
    const { data: creado } = await admin
      .from("journal_entries")
      .select("entry_number")
      .eq("id", entryId)
      .maybeSingle();

    const { error: errCache } = await admin
      .from("expenses")
      .update({ posted_entry_id: entryId })
      .eq("id", params.id)
      .eq("tenant_id", tenantId);

    if (errCache) {
      // El trigger de la `038` deja pasar este UPDATE a propósito:
      // `posted_entry_id` no está en su lista de columnas protegidas.
      console.error(
        "[expenses/post-to-ledger] el asiento se posteó pero el cache no se pudo escribir",
        { expenseId: params.id, entryId, error: errCache }
      );
    }

    return NextResponse.json(
      {
        entry_id: entryId,
        entry_number: (creado as { entry_number: number } | null)?.entry_number ?? null,
        lineas: armado.asiento.lines.length,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[expenses/post-to-ledger] error", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
