/**
 * POST /api/finanzas/asientos — registra un asiento manual de diario.
 *
 * Copia el patrón de `app/api/expenses/[id]/post-to-ledger/route.ts`, que fue la
 * primera ruta de `/api` que escribió en el ledger (SOP-014, "el patrón de una
 * ruta que postea"). Las diferencias son tres, y las tres importan:
 *
 *   1. **No hay documento de origen.** `source_id` va NULL, así que el UNIQUE de
 *      la `034` no aplica y la idempotencia la da `idempotency_key` (`039`).
 *   2. **No hay guard de cuentas.** Ver abajo.
 *   3. **El rol es otro:** admin y contador, no admin y abogada.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 ACÁ NO SE USA `esTipoValidoParaGasto()`. NUNCA.
 * ─────────────────────────────────────────────────────────────────────────────
 * Un asiento manual es el mecanismo para tocar lo que ningún documento toca: el
 * aporte de capital va contra **patrimonio**, un ajuste de ingresos diferidos
 * contra **ingreso**. El guard de gastos convertiría la herramienta de ajuste en
 * la única que no puede ajustar. El único filtro que corresponde —cuenta del plan
 * y activa— ya lo hace el RPC. Ver `contabilidad/asiento-manual.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SOP-014, PUNTO POR PUNTO
 * ─────────────────────────────────────────────────────────────────────────────
 * Server-side · cliente de servicio · `tenant_id` del PERFIL y nunca del body ·
 * al ledger solo por `postJournalEntry()`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IDEMPOTENCIA — dos capas, y la segunda es la garantía
 * ─────────────────────────────────────────────────────────────────────────────
 * Un asiento duplicado NO SE BORRA, y acá no hay `source_id` que lo una a nada.
 *
 *   1. **`SELECT` sobre `idempotency_key`** → el mensaje entendible.
 *   2. **El UNIQUE parcial de la `039`** → LA garantía. La capa 1 deja una
 *      ventana entre el SELECT y el INSERT que dos requests simultáneos pasan.
 *
 * El `23505` se traduce al MISMO mensaje de la capa 1: para quien apretó dos
 * veces, las dos rutas tienen que contar lo mismo.
 */

import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/supabase/server-query";
import { postJournalEntry } from "@/lib/finanzas/contabilidad/posting";
import { MutationError } from "@/lib/finanzas/api/errors";
import {
  armarAsientoManual,
  type LineaManualDraft,
} from "@/lib/finanzas/contabilidad/asiento-manual";

export const runtime = "nodejs";

/**
 * Admin y contador. La abogada NO.
 *
 * Mismo criterio que `ROLES_CLASIFICACION` en `api/chart-of-accounts.ts`: la guía
 * de RM dice que quien modifica la clasificación contable de una cuenta debe ser
 * el contador. Un asiento manual es más sensible todavía — escribe directo en el
 * libro sin documento que lo respalde. Si la abogada no puede lo menos, no puede
 * lo más.
 *
 * ⚠️ Tiene que coincidir con `ADMIN_CONTADOR_ONLY_PREFIXES` de `route-access.ts`.
 */
const ROLES_ASIENTO_MANUAL = ["admin", "contador"] as const;

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** El mensaje de "ya se registró", en UN lugar: lo usan las dos capas. */
function yaRegistrado(numero: number | null): string {
  return numero === null
    ? "Este asiento ya se registró. Recargá la pantalla para verlo."
    : `Este asiento ya se registró: es el número ${numero}. Recargá la pantalla para verlo.`;
}

/**
 * Traduce el mensaje del RPC cuando el período no existe.
 *
 * El original nombra `ensure_accounting_periods()`, que a un contador no le dice
 * nada — es una función de Postgres. Los demás mensajes del RPC pasan tal cual
 * porque ya están redactados para leerse (ver `028` y `030`).
 */
function traducirMensajeDelRpc(mensaje: string): string {
  const m = mensaje.match(/No existe el período contable (\d{4})-(\d{2})/);
  if (!m) return mensaje;
  return (
    `El ejercicio ${m[1]} no está abierto en el sistema, así que no se pueden ` +
    `registrar asientos con fecha de ${m[2]}/${m[1]}. Un administrador tiene que ` +
    `abrirlo primero.`
  );
}

export async function POST(request: NextRequest) {
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

    const denied = requireRole(profile.role, ROLES_ASIENTO_MANUAL);
    if (denied) return denied;

    // 🔑 El tenant sale de ACÁ, del perfil del usuario autenticado. Un
    // `tenant_id` en el body sería un intento de escribir en el ledger de otro
    // bufete, y el RPC ya no corre bajo RLS (SOP-014).
    const tenantId = profile.tenant_id as string;

    const body = await request.json();
    const fecha: unknown = body?.transaction_date;
    const descripcion: unknown = body?.description;
    const referencia: unknown = body?.reference;
    const token: unknown = body?.idempotency_key;
    const lineasRaw: unknown = body?.lines;

    if (typeof fecha !== "string" || !FECHA_RE.test(fecha)) {
      return NextResponse.json(
        { error: "Indicá la fecha del asiento (AAAA-MM-DD)." },
        { status: 400 }
      );
    }
    if (typeof descripcion !== "string" || descripcion.trim().length < 3) {
      return NextResponse.json(
        {
          error:
            "El asiento necesita una descripción de su naturaleza: qué operación registra (mínimo 3 caracteres).",
        },
        { status: 400 }
      );
    }
    if (!Array.isArray(lineasRaw)) {
      return NextResponse.json({ error: "Faltan las líneas del asiento." }, { status: 400 });
    }
    if (typeof token !== "string" || token.trim() === "") {
      // Sin token no hay nada que impida el doble posteo, y un asiento duplicado
      // no se borra. Se exige en vez de dejarlo opcional.
      return NextResponse.json(
        { error: "Falta el identificador del formulario. Recargá la pantalla." },
        { status: 400 }
      );
    }

    const armado = armarAsientoManual(lineasRaw as LineaManualDraft[]);
    if (!armado.ok) {
      return NextResponse.json({ error: armado.mensaje }, { status: 400 });
    }

    // ── CAPA 1: el mensaje entendible ───────────────────────────────────────
    const { data: previo, error: errPrevio } = await admin
      .from("journal_entries")
      .select("entry_number")
      .eq("tenant_id", tenantId)
      .eq("idempotency_key", token.trim())
      .maybeSingle();

    if (errPrevio) {
      // Ante la duda NO se postea: es lo único que no se puede deshacer.
      console.error("[finanzas/asientos] idempotency lookup failed", errPrevio);
      return NextResponse.json(
        { error: "No se pudo verificar si el asiento ya estaba registrado. No se registró nada." },
        { status: 500 }
      );
    }
    if (previo) {
      return NextResponse.json(
        { error: yaRegistrado((previo as { entry_number: number }).entry_number) },
        { status: 409 }
      );
    }

    // ── EL POSTEO ───────────────────────────────────────────────────────────
    let entryId: string;
    try {
      entryId = await postJournalEntry(
        admin,
        tenantId,
        {
          transaction_date: fecha,
          description: descripcion.trim(),
          source_type: "manual",
          // Sin documento de origen: es lo que define un asiento manual, y es
          // también lo que lo deja fuera del UNIQUE de la `034`.
          source_id: null,
          lines: armado.lineas,
          reference:
            typeof referencia === "string" && referencia.trim() !== ""
              ? referencia.trim()
              : null,
          idempotency_key: token.trim(),
        },
        user.id
      );
    } catch (err) {
      // ── CAPA 2: el UNIQUE de la `039` ────────────────────────────────────
      // El doble clic: dos requests pasaron la capa 1 a la vez y el índice frenó
      // al segundo. ⚠️ El código de Postgres viaja en `MutationError.detail`, NO
      // en `cause` — ver SOP-014.
      const detalle = (err as MutationError)?.detail;
      const codigo =
        detalle && typeof detalle === "object"
          ? (detalle as { code?: string }).code
          : (err as { code?: string })?.code;

      if (codigo === "23505") {
        const { data: ganador } = await admin
          .from("journal_entries")
          .select("entry_number")
          .eq("tenant_id", tenantId)
          .eq("idempotency_key", token.trim())
          .maybeSingle();
        return NextResponse.json(
          { error: yaRegistrado((ganador as { entry_number: number } | null)?.entry_number ?? null) },
          { status: 409 }
        );
      }

      if (err instanceof MutationError) {
        // Los mensajes del RPC ya vienen redactados en español (cuadre, período
        // cerrado, cuentas inexistentes). Solo se traduce el que nombra una
        // función de Postgres.
        return NextResponse.json(
          { error: traducirMensajeDelRpc(err.message) },
          { status: err.status }
        );
      }
      throw err;
    }

    const { data: creado } = await admin
      .from("journal_entries")
      .select("entry_number, record_date, transaction_date")
      .eq("id", entryId)
      .maybeSingle();

    const fila = creado as
      | { entry_number: number; record_date: string; transaction_date: string }
      | null;

    return NextResponse.json(
      {
        entry_id: entryId,
        entry_number: fila?.entry_number ?? null,
        // Las DOS fechas del Art. 13a. La de registro la pone el ledger, y
        // mostrarla es lo que le demuestra al contador que el sistema las guarda
        // separadas.
        transaction_date: fila?.transaction_date ?? fecha,
        record_date: fila?.record_date ?? null,
        lineas: armado.lineas.length,
        total: armado.totales.debitos,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[finanzas/asientos] error", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
