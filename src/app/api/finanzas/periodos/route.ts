/**
 * GET / PATCH `/api/finanzas/periodos` — cerrar y reabrir períodos contables.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ESTO NO CONSTRUYE EL BLOQUEO: LO OPERA
 * ═════════════════════════════════════════════════════════════════════════════
 * `accounting_periods` existe desde la `023` y `post_journal_entry` ya rechaza
 * todo asiento cuya fecha caiga en un período `cerrado` (paso 6 de la `030`,
 * verificado contra staging). Lo que faltaba era **poder cerrarlo desde la
 * aplicación**: hasta hoy se hacía con un `UPDATE` a mano en el SQL Editor.
 *
 * Por eso esta ruta NO valida fechas de asientos ni duplica la regla del cierre.
 * Solo cambia `status`, y el motor hace el resto.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SOP-014
 * ─────────────────────────────────────────────────────────────────────────────
 * Server-side · cliente de servicio · `tenant_id` del PERFIL, nunca del body.
 *
 * La `030` dejó a `service_role` con UPDATE sobre `accounting_periods` —y solo
 * UPDATE: le revocó INSERT, DELETE y TRUNCATE— justamente para esto. Crear
 * períodos sigue siendo exclusivo de `ensure_accounting_periods()`, así que esta
 * ruta **no puede crear ni borrar uno**: solo abre y cierra los que existen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 AL REABRIR, `closed_at` Y `closed_by` SE CONSERVAN. NO SE LIMPIAN.
 * ─────────────────────────────────────────────────────────────────────────────
 * Es la decisión de diseño de este archivo, y va al revés de lo que parece
 * "prolijo".
 *
 * Limpiarlos dejaría un período reabierto **idéntico a uno que nunca se cerró**.
 * Y no son lo mismo: el segundo nunca se certificó; el primero es un ejercicio
 * que el contador YA dio por cerrado ante la DGI y que hoy vuelve a admitir
 * asientos. Borrar esas dos columnas borra exactamente el hecho que hay que ver.
 *
 * Conservándolas, `status = 'abierto'` + `closed_at IS NOT NULL` es un estado
 * legible —"reabierto"— que la pantalla muestra distinto de "abierto", con la
 * fecha del cierre que se deshizo y el nombre de quien lo había cerrado.
 *
 * ⚠️ Lo que esas dos columnas NO pueden hacer, y por eso hace falta lo de abajo:
 * guardan solo el ÚLTIMO cierre. En un ciclo cerrar → reabrir → cerrar, la
 * primera fecha se pisa. **El historial completo va a `audit_log`**, con una
 * entrada por transición, su autor y su momento. Es el patrón que el repo ya usa
 * para el plan de cuentas y los catálogos.
 */

import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/supabase/server-query";
import { listarPeriodos } from "@/lib/finanzas/queries/periodos";
import {
  codigoPeriodo,
  esAccionPeriodo,
  laAccionCambiaAlgo,
} from "@/lib/finanzas/contabilidad/periodos";

export const runtime = "nodejs";

/**
 * Admin y contador. La abogada NO.
 *
 * Mismo criterio que los asientos manuales: cerrar un período decide qué
 * ejercicio admite movimientos, que es una atribución de cierre contable. Tiene
 * que coincidir con `ADMIN_CONTADOR_ONLY_PREFIXES` de `route-access.ts`.
 */
const ROLES_PERIODOS = ["admin", "contador"] as const;

const ENTITY = "accounting_period";

async function contexto() {
  const supabase = createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("users")
    .select("tenant_id, role")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return { error: NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 }) };
  }

  const denied = requireRole(profile.role, ROLES_PERIODOS);
  if (denied) return { error: denied };

  // 🔑 El tenant sale de ACÁ. Nunca del body.
  return { admin, user, tenantId: profile.tenant_id as string };
}

export async function GET() {
  try {
    const ctx = await contexto();
    if ("error" in ctx) return ctx.error;

    const periodos = await listarPeriodos(ctx.admin, ctx.tenantId);
    return NextResponse.json({ periodos });
  } catch (err) {
    console.error("[finanzas/periodos GET] error", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await contexto();
    if ("error" in ctx) return ctx.error;
    const { admin, user, tenantId } = ctx;

    const body = await request.json();
    const year: unknown = body?.year;
    const month: unknown = body?.month;
    const accion: unknown = body?.accion;

    if (typeof year !== "number" || !Number.isInteger(year)) {
      return NextResponse.json({ error: "Falta el año del período." }, { status: 400 });
    }
    if (typeof month !== "number" || !Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: "Falta el mes del período." }, { status: 400 });
    }
    if (!esAccionPeriodo(accion)) {
      return NextResponse.json(
        { error: "La acción tiene que ser 'cerrar' o 'reabrir'." },
        { status: 400 }
      );
    }

    // El período tiene que EXISTIR. Esta ruta no lo crea: crear períodos es
    // exclusivo de `ensure_accounting_periods()`, y la `030` le revocó INSERT
    // a `service_role` justamente para que no haya dos caminos.
    const { data: periodo, error: errLookup } = await admin
      .from("accounting_periods")
      .select("id, status, closed_at")
      .eq("tenant_id", tenantId)
      .eq("year", year)
      .eq("month", month)
      .maybeSingle();

    if (errLookup) {
      console.error("[finanzas/periodos PATCH] lookup failed", errLookup);
      return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
    if (!periodo) {
      return NextResponse.json(
        {
          error:
            `El período ${codigoPeriodo(year, month)} no existe en el sistema. ` +
            `Los períodos se crean solos al registrar el primer asiento del año.`,
        },
        { status: 404 }
      );
    }

    const fila = periodo as { id: string; status: "abierto" | "cerrado"; closed_at: string | null };

    // Cerrar lo ya cerrado, o reabrir lo abierto, no es un error: es un doble
    // clic o dos personas a la vez. Se contesta sin escribir — y no escribir es
    // lo importante: un cierre repetido pisaría `closed_at` con una fecha nueva
    // y perdería la original.
    if (!laAccionCambiaAlgo(fila.status, accion)) {
      return NextResponse.json({
        sinCambios: true,
        estado: fila.status,
        mensaje:
          accion === "cerrar"
            ? `El período ${codigoPeriodo(year, month)} ya estaba cerrado.`
            : `El período ${codigoPeriodo(year, month)} ya estaba abierto.`,
      });
    }

    // ── LA ESCRITURA ────────────────────────────────────────────────────────
    // Al REABRIR solo cambia `status`: `closed_at` y `closed_by` se conservan a
    // propósito. Ver el encabezado — es lo que distingue un período reabierto de
    // uno que nunca se cerró.
    const cambios =
      accion === "cerrar"
        ? { status: "cerrado", closed_at: new Date().toISOString(), closed_by: user.id }
        : { status: "abierto" };

    const { error: errUpdate } = await admin
      .from("accounting_periods")
      .update(cambios)
      .eq("id", fila.id)
      .eq("tenant_id", tenantId);

    if (errUpdate) {
      console.error("[finanzas/periodos PATCH] update failed", errUpdate);
      return NextResponse.json(
        { error: `No se pudo ${accion} el período. No se cambió nada.` },
        { status: 500 }
      );
    }

    // El historial completo. `closed_at` guarda solo el último cierre; acá queda
    // cada transición con su autor y su momento.
    //
    // ⚠️ `action` va como `"update"` y NO como `"close"` / `"reopen"`: la columna
    // tiene `CHECK (action IN ('create','update','delete'))` desde el esquema
    // inicial, y un valor fuera de esa lista lo rechaza la base. Cerrar y reabrir
    // se distinguen igual, por la transición: `abierto → cerrado` es un cierre y
    // `cerrado → abierto` una reapertura. Ampliar el CHECK sería una migración, y
    // este bloque no lleva ninguna.
    const { error: errAudit } = await admin.from("audit_log").insert({
      tenant_id: tenantId,
      user_id: user.id,
      entity: ENTITY,
      entity_id: fila.id,
      action: "update",
      field: "status",
      old_value: fila.status,
      new_value: accion === "cerrar" ? "cerrado" : "abierto",
    });

    // Si la auditoría falla, el período YA cambió y eso es lo que importa: se
    // loguea y se sigue. Devolver un error haría que alguien reintente una acción
    // que ya surtió efecto — y en el caso de "cerrar", el reintento contestaría
    // "ya estaba cerrado" y lo dejaría dudando de si funcionó.
    if (errAudit) {
      console.error("[finanzas/periodos PATCH] audit_log falló", {
        periodo: codigoPeriodo(year, month),
        accion,
        error: errAudit,
      });
    }

    return NextResponse.json({
      year,
      month,
      periodo: codigoPeriodo(year, month),
      estado: accion === "cerrar" ? "cerrado" : "abierto",
      // Se devuelve para que la pantalla pueda decir "reabierto" sin recargar.
      fueCerradoAlgunaVez: accion === "cerrar" ? true : Boolean(fila.closed_at),
    });
  } catch (err) {
    console.error("[finanzas/periodos PATCH] error", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
