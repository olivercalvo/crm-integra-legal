import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext, requireRole } from "@/lib/supabase/server-query";
import {
  createChartAccount,
  updateChartAccount,
} from "@/lib/finanzas/api/chart-of-accounts";
import { findChartAccountsByCodes } from "@/lib/finanzas/queries/chart-of-accounts";
import {
  classifyRows,
  type ClassifiedRow,
} from "@/lib/finanzas/import/chart-of-accounts-mapping";
import {
  parseChartAccountsFile,
  WorkbookParseError,
} from "@/lib/finanzas/import/chart-of-accounts-workbook";
import { MutationError } from "@/lib/finanzas/api/errors";
import { inicioPeriodoFiscal } from "@/lib/finanzas/contabilidad/periodo-fiscal";
import type { AccountType } from "@/lib/finanzas/types/chart-of-account";

/**
 * POST /api/finanzas/configuracion/chart-of-accounts/bulk
 * Carga masiva del Plan de Cuentas desde .xlsx/.csv (Paso 1b del plan contable).
 *
 * Dos modos, MISMO archivo:
 *   - mode=preview → parsea, clasifica crear/actualizar/error y devuelve el
 *     detalle SIN ESCRIBIR NADA.
 *   - mode=commit  → vuelve a parsear y aplica los cambios.
 *
 * El commit re-parsea en vez de confiar en las filas que manda el cliente. Es a
 * propósito: si el navegador pudiera postear el JSON ya clasificado, un cliente
 * modificado podría inyectar filas que nunca pasaron por la validación del
 * preview. El archivo es la única fuente de verdad.
 *
 * Gating: mismo set de roles que la creación de cuentas (el asistente ya queda
 * afuera por middleware; se rechaza igual acá por defensa en profundidad).
 */
const FINANZAS_ROLES = ["admin", "abogada", "contador"] as const;

/** Tope de filas por archivo: el plan de Josuar son 62 cuentas. */
const MAX_ROWS = 1000;

/** Tope de tamaño del archivo subido (5 MB). */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

interface RowOutcome {
  rowNumber: number;
  code: string;
  action: "created" | "updated" | "error";
  message?: string;
}

export async function POST(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, FINANZAS_ROLES);
  if (denied) return denied;

  // ---- Archivo + modo ----
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Se esperaba multipart/form-data" }, { status: 400 });
  }

  const mode = String(form.get("mode") ?? "preview");
  if (mode !== "preview" && mode !== "commit") {
    return NextResponse.json({ error: "Modo inválido (preview | commit)" }, { status: 400 });
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "El archivo está vacío" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "El archivo supera los 5 MB permitidos" },
      { status: 400 }
    );
  }

  // ---- Parseo (puro, sin BD) ----
  let parsed;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    parsed = parseChartAccountsFile(buffer);
  } catch (err) {
    if (err instanceof WorkbookParseError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[finanzas] bulk chart-of-accounts parse failed", err);
    return NextResponse.json({ error: "No se pudo leer el archivo" }, { status: 400 });
  }

  if (parsed.rows.length === 0) {
    return NextResponse.json(
      {
        error:
          "No se encontró ninguna cuenta en el archivo. Revise que la columna Código tenga valores.",
      },
      { status: 400 }
    );
  }
  if (parsed.rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `El archivo trae ${parsed.rows.length} cuentas; el máximo por carga es ${MAX_ROWS}.` },
      { status: 400 }
    );
  }

  // ---- Clasificación contra lo que ya existe ----
  let existing;
  try {
    existing = await findChartAccountsByCodes(
      ctx.db,
      ctx.tenantId,
      parsed.rows.map((r) => r.code)
    );
  } catch {
    return NextResponse.json(
      { error: "Error al consultar las cuentas existentes" },
      { status: 500 }
    );
  }

  const { rows, counts } = classifyRows(parsed.rows, existing);

  if (mode === "preview") {
    return NextResponse.json(
      {
        preview: {
          headerRowIndex: parsed.headerRowIndex,
          skippedRows: parsed.skippedRows,
          hasSubcategoriaColumn: parsed.columns.subcategoria !== -1,
          hasSaldoColumn: parsed.columns.saldo !== -1,
          counts,
          rows,
        },
      },
      { status: 200 }
    );
  }

  // ---- COMMIT ----
  // Secuencial a propósito: son decenas de filas en una acción manual y
  // ordenado hace que el audit_log quede legible y el resumen determinista.
  // Una fila que falla NO aborta el resto: se reporta y se sigue, porque
  // rehacer una carga de 62 cuentas por un typo en la fila 40 es peor.
  /**
   * Fecha del saldo para las filas que traigan monto.
   *
   * El Excel de Josuar NO tiene columna de fecha, y desde la Tarea 5 un saldo
   * distinto de 0 la exige (CHECK `coa_saldo_inicial_requiere_fecha`). Se usa el
   * inicio del período fiscal en curso, que es la regla que dio Rose: el período
   * va del 1 de enero al 31 de diciembre.
   *
   * En los UPDATE se PRESERVA la fecha que ya tenga la cuenta y esta solo actúa
   * de respaldo, para no pisar una corrección hecha a mano en la pantalla.
   */
  const fechaSaldoPorDefecto = inicioPeriodoFiscal(new Date().getFullYear());

  const outcomes: RowOutcome[] = [];
  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const row of rows) {
    if (row.action === "error") {
      failed++;
      outcomes.push({
        rowNumber: row.rowNumber,
        code: row.code,
        action: "error",
        message: row.errors.join(" · "),
      });
      continue;
    }

    try {
      if (row.action === "create") {
        await createChartAccount(ctx.db, ctx.tenantId, ctx.userId, {
          code: row.code,
          name: row.name,
          account_type: row.account_type as AccountType,
          subcategoria: row.subcategoria,
          // El Excel no trae cuenta control: se marca a mano en la pantalla.
          cuenta_control: null,
          saldo_inicial: row.saldo_inicial,
          saldo_inicial_fecha:
            row.saldo_inicial === 0 ? null : fechaSaldoPorDefecto,
          description: null,
          active: true,
        });
        created++;
        outcomes.push({ rowNumber: row.rowNumber, code: row.code, action: "created" });
      } else {
        const match = existing.get(row.code);
        if (!match) {
          // No debería pasar (classifyRows lo marcó como update porque estaba).
          throw new MutationError("La cuenta dejó de existir durante la carga", 409);
        }
        await updateChartAccount(ctx.db, ctx.tenantId, match.id, ctx.userId, ctx.userRole, {
          name: row.name,
          account_type: row.account_type as AccountType,
          subcategoria: row.subcategoria,
          saldo_inicial: row.saldo_inicial,
          saldo_inicial_fecha:
            row.saldo_inicial === 0
              ? null
              : match.saldo_inicial_fecha ?? fechaSaldoPorDefecto,
          // PRESERVAR: el PATCH es reemplazo total. Ni la descripción ni la
          // cuenta control vienen en el Excel, y el import no debe activar ni
          // desactivar cuentas.
          description: match.description,
          cuenta_control: match.cuenta_control,
          active: match.active,
        });
        updated++;
        outcomes.push({ rowNumber: row.rowNumber, code: row.code, action: "updated" });
      }
    } catch (err) {
      failed++;
      const message =
        err instanceof MutationError ? err.message : "Error inesperado al guardar la fila";
      if (!(err instanceof MutationError)) {
        console.error("[finanzas] bulk row failed", row.code, err);
      }
      outcomes.push({ rowNumber: row.rowNumber, code: row.code, action: "error", message });
    }
  }

  return NextResponse.json(
    {
      summary: { created, updated, failed, skippedRows: parsed.skippedRows },
      outcomes,
    },
    { status: 200 }
  );
}

export type { ClassifiedRow };
