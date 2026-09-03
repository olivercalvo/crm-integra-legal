import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/supabase/server-query";
import { validarLineas } from "@/lib/finanzas/validators/expense-line";
import type { ExpenseLineDraft } from "@/lib/finanzas/types/expense-line";

// Gastos es admin/abogada. El contador tiene su propio módulo
// (/finanzas/gastos-bufete) y el asistente quedó fuera del alcance de gastos
// el 24/08/2026. Ocultar el menú NO alcanza: sin este gate, cualquier rol
// autenticado podía crear un gasto llamando el endpoint directamente.
const EXPENSE_WRITE_ROLES = ["admin", "abogada"] as const;

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();

    // Authenticate
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const admin = createAdminClient();

    // Get user's tenant_id + role
    const { data: profile, error: profileError } = await admin
      .from("users")
      .select("tenant_id, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Perfil de usuario no encontrado" }, { status: 403 });
    }

    const denied = requireRole(profile.role, EXPENSE_WRITE_ROLES);
    if (denied) return denied;

    const body = await request.json();
    const { case_id, concept, date, expense_type, supplier_id, due_date } = body;
    const lineasRaw = body?.lines;

    if (!case_id || !concept || !date) {
      return NextResponse.json({ error: "Faltan campos requeridos: case_id, concept, date" }, { status: 400 });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 🔴 LAS LÍNEAS SON OBLIGATORIAS, Y EL MONTO SALE DE ELLAS
    // ─────────────────────────────────────────────────────────────────────────
    // Desde la `036` un gasto de trámite es encabezado + líneas. Esta ruta NO
    // acepta ya el `amount` suelto del modelo viejo, y no es una restricción
    // gratuita: un gasto sin líneas **no se puede postear al libro** —el builder
    // no tiene contra qué cuenta armar el asiento— así que aceptarlo sería crear
    // en silencio documentos que nunca van a llegar a la contabilidad.
    //
    // Y las líneas se validan ACÁ, del lado del servidor. `expense_lines.
    // chart_account_code` es NULLABLE (las del backfill histórico dicen la
    // verdad: nadie las clasificó), así que el `NOT NULL` de una línea NUEVA lo
    // hace cumplir `validarLineas()` — más el CHECK de la `037`, que es la
    // garantía que un `curl` no puede saltear.
    if (!Array.isArray(lineasRaw) || lineasRaw.length === 0) {
      return NextResponse.json(
        { error: "Agregue al menos una línea de detalle con su cuenta contable" },
        { status: 400 }
      );
    }

    const validadas = validarLineas(lineasRaw as ExpenseLineDraft[]);
    if (!validadas.ok) {
      return NextResponse.json(
        { error: "Revise las líneas del gasto", fieldErrors: validadas.errors },
        { status: 400 }
      );
    }

    // El monto del encabezado ES la suma de las líneas. Conviven hasta que
    // `amount` se vuelva derivado por trigger (commit posterior), y el que manda
    // es el detalle: nunca se toma un monto que venga del request.
    const total = validadas.data.totales.total;

    const { data: expense, error: insertError } = await admin
      .from("expenses")
      .insert({
        tenant_id: profile.tenant_id,
        case_id,
        amount: total,
        concept: concept.trim(),
        date,
        expense_type: expense_type === "administrativo" ? "administrativo" : "tramite",
        registered_by: user.id,
        supplier_id: typeof supplier_id === "string" && supplier_id ? supplier_id : null,
        due_date: typeof due_date === "string" && due_date ? due_date : null,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error inserting expense:", insertError);
      return NextResponse.json({ error: "Error al registrar el gasto" }, { status: 500 });
    }

    const { error: errLineas } = await admin.from("expense_lines").insert(
      validadas.data.lineas.map((l) => ({
        tenant_id: profile.tenant_id,
        expense_id: expense.id,
        line_order: l.line_order,
        description: l.description,
        chart_account_code: l.chart_account_code,
        amount: l.amount,
        tax_rate: l.tax_rate,
        tax_amount: l.tax_amount,
        created_by: user.id,
      }))
    );

    if (errLineas) {
      // Compensating delete: un gasto sin líneas no se puede postear y quedaría
      // como basura invisible. Se puede borrar sin riesgo porque todavía no tiene
      // asiento — el trigger de la `038` lo dejaría pasar igual por eso mismo.
      console.error("Error inserting expense lines:", errLineas);
      await admin.from("expenses").delete().eq("id", expense.id);
      return NextResponse.json(
        { error: "Error al registrar el detalle del gasto. No se guardó nada." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ...expense, lineas: validadas.data.lineas.length }, { status: 201 });
  } catch (err) {
    console.error("Unexpected error in POST /api/expenses:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
