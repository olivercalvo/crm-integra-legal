/**
 * POST /api/expenses/lines/bulk-classify
 *
 * Asigna una cuenta contable a varias líneas de gasto de una sola vez.
 *
 * Existe por un motivo práctico: la migración `036` dejó 128 gastos históricos
 * sin clasificar y **la mayoría van a la misma cuenta** (`130003`). Obligar a 128
 * decisiones individuales es lo que hace que una limpieza no se haga nunca y el
 * estado quede así para siempre.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔑 SOLO ESCRIBE DONDE `chart_account_code IS NULL`. NUNCA PISA NADA.
 * ═════════════════════════════════════════════════════════════════════════════
 * Es la restricción que vuelve segura una operación masiva. Sin ella, un clic
 * sobre 40 líneas puede destruir clasificaciones que alguien decidió una por una
 * y que nadie recuerda cuáles eran. Con ella, la masiva **solo llena blancos**:
 * lo peor que puede pasar es que no haga nada.
 *
 * ⚠️ **Y ese mismo `WHERE` hace un segundo trabajo, que no es obvio: garantiza
 * que la masiva nunca toca un gasto que ya está en el libro contable.**
 *
 * El razonamiento es este, y hay que leerlo entero antes de "mejorar" el código:
 * un gasto no se puede postear con líneas sin cuenta —el builder del asiento no
 * puede armar una línea contra `NULL`, y desde la `037` la base tampoco deja
 * nacer una así—, o sea que **toda línea en NULL pertenece por definición a un
 * gasto NO posteado**. El filtro de clasificación y el filtro de inmutabilidad
 * son el mismo filtro.
 *
 * 🚫 **Por eso NO hay un guard aparte de "no tocar gastos posteados" en esta
 * ruta, y no es un olvido.** Un segundo chequeo que siempre da lo mismo que el
 * primero es código que nadie puede probar que haga falta, y el día que alguien
 * lo simplifique va a sacar el equivocado. Está nombrado acá para que se entienda
 * que la garantía existe y dónde vive.
 *
 * (La ruta de clasificación INDIVIDUAL sí lleva ese guard, porque ahí sí se puede
 * pedir cambiar una cuenta ya asignada — ver `../[id]/route.ts`.)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PERMISOS
 * ─────────────────────────────────────────────────────────────────────────────
 * admin y abogada, el mismo gate que `/legal/gastos` y que `POST /api/expenses`.
 * El asistente quedó fuera de gastos el 24/08/2026 y el contador no entra al
 * módulo Legal.
 *
 * El `tenant_id` sale del PERFIL del usuario autenticado, nunca del body
 * (SOP-014). Un `tenant_id` en el cuerpo sería un intento de escribir en los
 * datos de otro bufete.
 */

import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/supabase/server-query";

export const runtime = "nodejs";

/** Mismo gate que `/legal/gastos` y que `POST /api/expenses`. */
const EXPENSE_WRITE_ROLES = ["admin", "abogada"] as const;

/** Tope por request. Con 128 líneas en producción alcanza de sobra. */
const MAX_LINEAS = 500;

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

    const denied = requireRole(profile.role, EXPENSE_WRITE_ROLES);
    if (denied) return denied;

    const body = await request.json();
    const lineIds: unknown = body?.line_ids;
    const code: unknown = body?.chart_account_code;

    if (!Array.isArray(lineIds) || lineIds.length === 0) {
      return NextResponse.json(
        { error: "Seleccione al menos un gasto para clasificar" },
        { status: 400 }
      );
    }
    if (lineIds.length > MAX_LINEAS) {
      return NextResponse.json(
        { error: `No se pueden clasificar más de ${MAX_LINEAS} líneas por vez` },
        { status: 400 }
      );
    }
    if (!lineIds.every((id): id is string => typeof id === "string" && id.length > 0)) {
      return NextResponse.json({ error: "Lista de líneas inválida" }, { status: 400 });
    }
    if (typeof code !== "string" || code.trim() === "") {
      return NextResponse.json(
        { error: "Elija la cuenta contable a asignar" },
        { status: 400 }
      );
    }

    const cuenta = code.trim();

    // La cuenta tiene que existir, estar activa y ser del mismo bufete. Sin esto
    // se puede escribir un código que ningún reporte sabe agrupar, y como
    // `chart_account_code` es un FK LÓGICO (sin constraint, igual que en
    // `business_expenses`) la base no lo impediría.
    const { data: cuentaRow, error: errCuenta } = await admin
      .from("chart_of_accounts")
      .select("code, name, active")
      .eq("tenant_id", profile.tenant_id)
      .eq("code", cuenta)
      .maybeSingle();

    if (errCuenta) {
      console.error("[expenses/lines/bulk-classify] cuenta lookup failed", errCuenta);
      return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
    if (!cuentaRow) {
      return NextResponse.json(
        { error: `La cuenta ${cuenta} no existe en el plan de cuentas` },
        { status: 400 }
      );
    }
    if (cuentaRow.active === false) {
      return NextResponse.json(
        {
          error: `La cuenta ${cuenta} está inactiva. Los reportes filtran por cuentas activas, así que el gasto no aparecería en ninguno.`,
        },
        { status: 400 }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 🔑 EL UPDATE. Los tres filtros, y ninguno es decorativo:
    //    · tenant_id  → aislamiento entre bufetes (el cliente de servicio saltea RLS)
    //    · in(ids)    → solo lo que la persona seleccionó
    //    · IS NULL    → solo llena blancos: no pisa una clasificación existente,
    //                   y por lo tanto tampoco toca un gasto ya posteado.
    //                   NO agregar un guard aparte para eso: ver el encabezado.
    // ─────────────────────────────────────────────────────────────────────────
    const { data: actualizadas, error: errUpdate } = await admin
      .from("expense_lines")
      .update({ chart_account_code: cuenta })
      .eq("tenant_id", profile.tenant_id)
      .in("id", lineIds)
      .is("chart_account_code", null)
      .select("id");

    if (errUpdate) {
      console.error("[expenses/lines/bulk-classify] update failed", errUpdate);
      return NextResponse.json(
        { error: "No se pudieron clasificar los gastos" },
        { status: 500 }
      );
    }

    const clasificadas = actualizadas?.length ?? 0;
    // La diferencia no es un error: son líneas que alguien ya había clasificado
    // entre que se cargó la pantalla y se apretó el botón. Se informa, no se falla.
    const omitidas = lineIds.length - clasificadas;

    return NextResponse.json({
      clasificadas,
      omitidas,
      chart_account_code: cuentaRow.code,
      chart_account_name: cuentaRow.name,
    });
  } catch (err) {
    console.error("[expenses/lines/bulk-classify] error", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
