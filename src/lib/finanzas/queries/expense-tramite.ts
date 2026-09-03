/**
 * LECTURA DE UN GASTO DE TRÁMITE para la pantalla contable.
 *
 * La consume `/finanzas/gastos-tramite/{id}`, la pantalla de solo lectura a la
 * que el Libro Mayor enlaza el asiento de un gasto de trámite.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔒 EL RECORTE DE PRIVACIDAD ES DE ESTE ARCHIVO, NO DE LA PANTALLA
 * ═════════════════════════════════════════════════════════════════════════════
 * Un gasto de trámite vive DENTRO de un caso, y los casos son confidenciales.
 * Esta pantalla le abre al contador una puerta al módulo legal que hoy no tiene,
 * así que el alcance se define acá —en el `select`— y no en el JSX.
 *
 * El motivo es concreto: si el `select` trajera el caso entero y la pantalla
 * eligiera qué mostrar, el dato confidencial YA ESTARÍA en el servidor y a un
 * `{caso.description}` de distancia. Cualquiera que agregue un campo a la
 * pantalla en seis meses lo tendría a mano sin darse cuenta de que no debe. Con
 * el recorte en el query, el dato **nunca sale de la base**.
 *
 * De `cases` se lee EXACTAMENTE UNA COLUMNA: `case_code`.
 *
 *   ✅ El NÚMERO del caso — le alcanza para identificar el gasto en su papel de
 *      trabajo, que es para lo que lo necesita.
 *   ❌ `description`, `observations`, `physical_location`, `classification_id`,
 *      `institution_id`, `responsible_id`, `status_id`, `client_id`, y con eso
 *      las partes, los documentos, las notas y el historial.
 *
 * Ampliar el acceso del contador al contenido legal por la puerta de atrás sería
 * un cambio de política del bufete, no una pantalla. Decisión de Oliver,
 * 03/09/2026.
 *
 * 🔒 **Hay un test que lo fija:** `gastos-tramite-privacidad.test.ts` lee este
 * archivo y la pantalla, y falla si aparece cualquier campo de `cases` que no
 * sea `case_code`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  totalesDeLineas,
  type ExpenseLineRow,
  type TotalesDeGasto,
} from "@/lib/finanzas/types/expense-line";

type DB = SupabaseClient;

/**
 * Las ÚNICAS columnas de `cases` que esta pantalla puede ver.
 *
 * Es una constante y no un literal dentro del `select` para que el test la pueda
 * leer y para que agregar una columna sea un acto deliberado y visible en el
 * diff, no un carácter más en una cadena larga.
 */
export const CAMPOS_DE_CASO_PERMITIDOS = ["case_code"] as const;

/** Un gasto de trámite, con lo que la vista contable puede ver y nada más. */
export interface GastoTramiteContable {
  id: string;
  /** Fecha en que se incurrió el gasto. */
  date: string;
  /** El concepto del encabezado (histórico; las líneas traen su descripción). */
  concept: string;
  expense_type: "tramite" | "administrativo";
  /** Monto del encabezado. Conviven con las líneas hasta que se vuelva derivado. */
  amount: number;
  /** Vencimiento, del plazo del proveedor. Editable, puede faltar. */
  due_date: string | null;
  /** Solo el CÓDIGO del caso. Nada más de `cases`. */
  case_code: string | null;
  /** Proveedor del documento, si tiene. */
  supplier_id: string | null
  supplier_legal_name: string | null;
  supplier_ruc: string | null;
  supplier_dv: string | null;
  /** true si hay comprobante adjunto. La URL no se expone: se sirve por ruta. */
  tiene_comprobante: boolean;
  receipt_filename: string | null;
  /** Número del asiento que lo registró, si ya está posteado. */
  entry_number: number | null;
  lineas: ExpenseLineRow[];
  totales: TotalesDeGasto;
}

/**
 * Trae un gasto de trámite por id, dentro del tenant. `null` si no existe.
 *
 * El `tenant_id` llega como parámetro y sale del perfil del usuario
 * autenticado, nunca del request (SOP-014).
 */
export async function getGastoTramiteContable(
  db: DB,
  tenantId: string,
  id: string
): Promise<GastoTramiteContable | null> {
  // ⚠️ De `cases` va SOLO `case_code`. Ver el encabezado antes de agregar algo.
  const { data, error } = await db
    .from("expenses")
    .select(
      `id, date, concept, expense_type, amount, due_date,
       receipt_url, receipt_filename,
       supplier_id,
       cases!inner(case_code),
       suppliers(legal_name, ruc, dv)`
    )
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    console.error("[finanzas/queries] getGastoTramiteContable failed", error);
    throw new Error("No se pudo leer el gasto de trámite");
  }
  if (!data) return null;

  const fila = data as Record<string, unknown>;
  const caso = (fila.cases ?? null) as { case_code: string } | null;
  const prov = (fila.suppliers ?? null) as
    | { legal_name: string; ruc: string | null; dv: string | null }
    | null;

  const lineas = await getLineasDeGastoTramite(db, tenantId, id);

  return {
    id: String(fila.id),
    date: String(fila.date),
    concept: String(fila.concept ?? ""),
    expense_type: fila.expense_type === "administrativo" ? "administrativo" : "tramite",
    amount: Number(fila.amount ?? 0),
    due_date: (fila.due_date as string | null) ?? null,
    case_code: caso?.case_code ?? null,
    supplier_id: (fila.supplier_id as string | null) ?? null,
    supplier_legal_name: prov?.legal_name ?? null,
    // 🔴 El RUC y el DV van SEPARADOS hasta la pantalla. Nunca se concatenan.
    supplier_ruc: prov?.ruc ?? null,
    supplier_dv: prov?.dv ?? null,
    tiene_comprobante: Boolean(fila.receipt_url),
    receipt_filename: (fila.receipt_filename as string | null) ?? null,
    entry_number: await getNumeroDeAsiento(db, tenantId, id),
    lineas,
    totales: totalesDeLineas(lineas),
  };
}

/**
 * Las líneas de un gasto, con el nombre de su cuenta resuelto contra el plan.
 *
 * El nombre se resuelve por JOIN sobre el CÓDIGO, que es la identidad contable y
 * es inmutable por regla de la app. `chart_account_code` no tiene FK a
 * `chart_of_accounts` (es un FK lógico, igual que
 * `business_expenses.chart_account_code`), así que una línea puede apuntar a un
 * código que ya no existe: en ese caso el nombre vuelve en `null` y la pantalla
 * muestra el código pelado. No se esconde la línea.
 */
export async function getLineasDeGastoTramite(
  db: DB,
  tenantId: string,
  expenseId: string
): Promise<ExpenseLineRow[]> {
  const { data, error } = await db
    .from("expense_lines")
    .select(
      `id, line_order, description, chart_account_code,
       amount, tax_rate, tax_amount, line_total`
    )
    .eq("tenant_id", tenantId)
    .eq("expense_id", expenseId)
    .order("line_order", { ascending: true });

  if (error) {
    console.error("[finanzas/queries] getLineasDeGastoTramite failed", error);
    throw new Error("No se pudieron leer las líneas del gasto");
  }

  const filas = (data ?? []) as Record<string, unknown>[];
  const codigos = Array.from(
    new Set(filas.map((f) => f.chart_account_code).filter((c): c is string => Boolean(c)))
  );

  const nombres = await getNombresDeCuenta(db, tenantId, codigos);

  return filas.map((f) => {
    const code = (f.chart_account_code as string | null) ?? null;
    return {
      id: String(f.id),
      line_order: Number(f.line_order),
      description: String(f.description ?? ""),
      // NULL para las líneas del backfill histórico: nadie las clasificó nunca.
      // Ver el comentario largo en `types/expense-line.ts`.
      chart_account_code: code,
      chart_account_name: code ? nombres.get(code) ?? null : null,
      amount: Number(f.amount ?? 0),
      tax_rate: Number(f.tax_rate ?? 0),
      tax_amount: Number(f.tax_amount ?? 0),
      line_total: Number(f.line_total ?? 0),
    };
  });
}

/** Mapa código → nombre, para los códigos que se piden. */
async function getNombresDeCuenta(
  db: DB,
  tenantId: string,
  codigos: string[]
): Promise<Map<string, string>> {
  if (codigos.length === 0) return new Map();

  const { data, error } = await db
    .from("chart_of_accounts")
    .select("code, name")
    .eq("tenant_id", tenantId)
    .in("code", codigos);

  if (error) {
    console.error("[finanzas/queries] getNombresDeCuenta failed", error);
    return new Map(); // el código pelado es peor que nada, pero no rompe la pantalla
  }

  return new Map(
    ((data ?? []) as { code: string; name: string }[]).map((c) => [c.code, c.name])
  );
}

/**
 * El número del asiento que registró este gasto, o `null` si todavía no está
 * posteado.
 *
 * `source_type` es `'gasto_tramite'` y NO `'gasto'`: ese valor ya está tomado
 * por `business_expenses` y lo usa `destino-documento.ts` para decidir a qué
 * pantalla lleva el ícono del mayor. Reusarlo mandaría un gasto de trámite a la
 * pantalla de compras — el mismo bug del 01/09 que originó ese archivo.
 */
export async function getNumeroDeAsiento(
  db: DB,
  tenantId: string,
  expenseId: string
): Promise<number | null> {
  const { data, error } = await db
    .from("journal_entries")
    .select("entry_number")
    .eq("tenant_id", tenantId)
    .eq("source_type", "gasto_tramite")
    .eq("source_id", expenseId)
    .maybeSingle();

  if (error) {
    console.error("[finanzas/queries] getNumeroDeAsiento failed", error);
    // No se asume "sin asiento" ante un error: mismo criterio que
    // `contarMovimientos()` en api/chart-of-accounts.ts, que bloquea si falla.
    throw new Error("No se pudo verificar si el gasto ya está registrado en el libro");
  }

  return data ? Number((data as { entry_number: number }).entry_number) : null;
}
