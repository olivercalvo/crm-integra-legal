/**
 * PATCH /api/expenses/lines/[id]
 *
 * Asigna o cambia la cuenta contable de UNA línea de gasto. Es lo que hace el
 * selector que aparece en cada fila de la vista "Gastos" de `/legal/gastos`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTA SÍ LLEVA EL GUARD DE "GASTO YA POSTEADO" Y LA MASIVA NO
 * ─────────────────────────────────────────────────────────────────────────────
 * La ruta masiva solo escribe donde `chart_account_code IS NULL`, y una línea en
 * NULL pertenece por definición a un gasto NO posteado — no se puede armar un
 * asiento contra una cuenta nula. Ahí el filtro de clasificación y el de
 * inmutabilidad son el mismo.
 *
 * Acá no: esta ruta acepta **cambiar una cuenta ya asignada**, que es una
 * operación legítima mientras el gasto no esté en el libro. Si ya lo está,
 * cambiarle la cuenta dejaría el asiento diciendo una cosa y el documento otra,
 * en silencio y para siempre —los asientos son inmutables por diseño—. Así que
 * el guard hace falta de verdad.
 *
 * Es el mismo patrón que el "GATE CONTABLE" de `api/invoices.ts:661`: se bloquea
 * con un mensaje entendible que nombra el asiento, y corregir va por reversión,
 * que es su propio bloque.
 *
 * ⚠️ El guard de la ruta NO es la garantía final. Esa es el trigger de
 * inmutabilidad que va con la ruta de posteo (`038`). Acá se bloquea para dar un
 * mensaje en español en vez de un error de base.
 *
 * PERMISOS: admin y abogada, el mismo gate que `/legal/gastos`. `tenant_id` del
 * perfil, nunca del body (SOP-014).
 */

import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/supabase/server-query";
import { motivoDeRechazo } from "@/lib/finanzas/contabilidad/cuentas-de-gasto";

export const runtime = "nodejs";

const EXPENSE_WRITE_ROLES = ["admin", "abogada"] as const;

export async function PATCH(
  request: NextRequest,
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

    const body = await request.json();
    const code: unknown = body?.chart_account_code;

    // La cuenta NO se puede vaciar. El NULL existe solo para las líneas
    // históricas que nadie clasificó nunca; volver a ponerlo a mano sería
    // fabricar ese estado, y desde la `037` la base lo rechaza igual.
    if (typeof code !== "string" || code.trim() === "") {
      return NextResponse.json(
        { error: "Elija una cuenta contable. Una línea no puede quedar sin cuenta." },
        { status: 400 }
      );
    }
    const cuenta = code.trim();

    // La línea, con su gasto, para poder chequear el asiento.
    const { data: linea, error: errLinea } = await admin
      .from("expense_lines")
      .select("id, expense_id, business_expense_id")
      .eq("id", params.id)
      .eq("tenant_id", profile.tenant_id)
      .maybeSingle();

    if (errLinea) {
      console.error("[expenses/lines PATCH] lookup failed", errLinea);
      return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
    if (!linea) {
      return NextResponse.json({ error: "Línea no encontrada" }, { status: 404 });
    }
    if (!linea.expense_id) {
      // Esta ruta es de gastos de trámite. Una línea de compra se edita desde
      // /finanzas/gastos-bufete, que tiene su propio gate de roles.
      return NextResponse.json(
        { error: "Esta línea no pertenece a un gasto de trámite" },
        { status: 400 }
      );
    }

    // ── GATE CONTABLE ───────────────────────────────────────────────────────
    const { data: asiento, error: errAsiento } = await admin
      .from("journal_entries")
      .select("entry_number")
      .eq("tenant_id", profile.tenant_id)
      .eq("source_type", "gasto_tramite")
      .eq("source_id", linea.expense_id)
      .maybeSingle();

    if (errAsiento) {
      // Ante la duda NO se asume que no hay asiento: mismo criterio que
      // `contarMovimientos()` en api/chart-of-accounts.ts, que bloquea si falla.
      console.error("[expenses/lines PATCH] asiento lookup failed", errAsiento);
      return NextResponse.json(
        { error: "No se pudo verificar si el gasto ya está en el libro contable" },
        { status: 500 }
      );
    }
    if (asiento) {
      const numero = (asiento as { entry_number: number }).entry_number;
      return NextResponse.json(
        {
          error:
            // ⚠️ NO prometer la reversión a secas: todavía no está construida, y
            // quien lea esto va a ir a buscarla. Ver task_plan.md §A-0-bis-2.
            `Este gasto ya está registrado en el libro contable (asiento ${numero}) ` +
            `y no se le puede cambiar la cuenta. Corregirlo requiere un asiento de reversión, ` +
            `que todavía no está disponible en el sistema: avísele a Oliver.`,
        },
        { status: 409 }
      );
    }

    // La cuenta tiene que existir, estar activa y ser del mismo bufete:
    // `chart_account_code` es un FK LÓGICO, la base no lo valida.
    const { data: cuentaRow } = await admin
      .from("chart_of_accounts")
      .select("code, name, active, account_type")
      .eq("tenant_id", profile.tenant_id)
      .eq("code", cuenta)
      .maybeSingle();

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

    // 🔴 Regla contable, no de interfaz: ver `contabilidad/cuentas-de-gasto.ts`.
    const rechazo = motivoDeRechazo(cuentaRow as never);
    if (rechazo) {
      return NextResponse.json({ error: rechazo }, { status: 400 });
    }

    const { error: errUpdate } = await admin
      .from("expense_lines")
      .update({ chart_account_code: cuenta })
      .eq("id", params.id)
      .eq("tenant_id", profile.tenant_id);

    if (errUpdate) {
      console.error("[expenses/lines PATCH] update failed", errUpdate);
      return NextResponse.json(
        { error: "No se pudo guardar la cuenta" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      id: params.id,
      chart_account_code: cuentaRow.code,
      chart_account_name: cuentaRow.name,
    });
  } catch (err) {
    console.error("[expenses/lines PATCH] error", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
