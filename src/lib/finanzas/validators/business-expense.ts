/**
 * Validadores manuales para business_expenses — sin Zod, sin react-hook-form.
 *
 * Mismo patrón que validators/invoice.ts: cada validador devuelve
 * `{ ok: true, data } | { ok: false, errors }` con `errors` como mapa flat
 * campo → mensaje en español, listo para mostrar inline en el form.
 *
 * Notas de diseño:
 *   - tax_rate: whitelist {0, 0.07, 0.10, 0.15} para Panamá actual (el CHECK
 *     de BD acepta cualquier valor en [0,1] para future-proof).
 *   - tax_amount: aceptamos el valor que llega (sin recalcular automático)
 *     porque el form permite override manual cuando el comprobante muestra
 *     un redondeo distinto. PERO verificamos coherencia con tolerancia
 *     ±0.02 contra subtotal × tax_rate, y enforzamos el CHECK de BD:
 *     - rate=0 ⇒ amount=0
 *     - rate>0 ∧ subtotal=0 ⇒ amount=0
 *     - rate>0 ∧ subtotal>0 ⇒ amount>0
 *   - payment_date: requerido si status='pagado' a nivel UI, pero a nivel BD
 *     puede ser NULL incluso con status='pagado' (CHECK lo permite). Acá
 *     forzamos el pattern UI: si status='pagado' y no llega payment_date,
 *     auto-asignamos hoy (el caller del form pasa el default).
 */

import type {
  LineaDeCompraInput,
  CreateBusinessExpenseInput,
  BusinessExpenseStatus,
  BusinessExpensePaymentMethod,
  BusinessExpenseTaxRate,
} from "@/lib/finanzas/types/business-expense";
import { VALID_TAX_RATES } from "@/lib/finanzas/types/business-expense";

export type ValidationErrors = Record<string, string>;

export type ValidationResult<T> =
  | { ok: true; data: T; errors: null }
  | { ok: false; data: null; errors: ValidationErrors };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const VALID_STATUSES: BusinessExpenseStatus[] = ["pendiente_pago", "pagado"];
/** Tolerancia (B/.) del ITBMS de una línea contra `amount × tax_rate`. Espejo de trámite. */
export const TOLERANCIA_IMPUESTO_LINEA = 0.02;
const VALID_PAYMENT_METHODS: BusinessExpensePaymentMethod[] = [
  "efectivo",
  "transferencia",
  "tarjeta",
  "cheque",
  "otro",
];

/**
 * La tasa que va en el ENCABEZADO, derivada de las líneas.
 *
 * No es un dato contable: el ITBMS real de la compra es la SUMA de los importes
 * de cada línea, y cada línea tiene su propia tasa. Esta tasa existe sólo porque
 * la columna existe desde antes de que hubiera líneas, y porque
 * `business_expenses_tax_consistency_check` la mira.
 *
 * La regla, que es la mínima que satisface ese CHECK y además no miente:
 *   · sin ITBMS  → 0   (compra íntegramente exenta)
 *   · con ITBMS  → la tasa MÁS ALTA entre las líneas que efectivamente lo pagan
 *
 * Con una sola tasa —el caso normal— devuelve exactamente esa tasa, así que las
 * compras de siempre se guardan igual que antes.
 */
function derivarTasaDeCabecera(lineas: LineaDeCompraInput[], taxAmount: number): number {
  if (taxAmount <= 0) return 0;
  const gravadas = lineas.filter((l) => l.tax_amount > 0).map((l) => l.tax_rate);
  return gravadas.length > 0 ? Math.max(...gravadas) : 0;
}

/**
 * Normaliza un tax_rate a uno de los valores whitelist. Acepta cualquier
 * representación numérica de los 4 valores soportados (0, 0.07, 0.10, 0.15)
 * con tolerancia de redondeo. Devuelve null si está fuera de la whitelist.
 */
function normalizeTaxRate(raw: unknown): BusinessExpenseTaxRate | null {
  const n = Number(raw);
  if (!isFinite(n)) return null;
  for (const valid of VALID_TAX_RATES) {
    if (Math.abs(n - valid) < 0.0001) return valid;
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Valida un payload de creación. */
export function validateCreateBusinessExpense(
  raw: Partial<CreateBusinessExpenseInput>
): ValidationResult<CreateBusinessExpenseInput> {
  const errors: ValidationErrors = {};

  // expense_date
  if (!raw.expense_date || !DATE_RE.test(String(raw.expense_date))) {
    errors.expense_date = "Fecha del gasto inválida (esperado YYYY-MM-DD)";
  }

  // description
  const description = String(raw.description ?? "").trim();
  if (!description) {
    errors.description = "Descripción requerida";
  } else if (description.length < 3) {
    errors.description = "Descripción muy corta (mínimo 3 caracteres)";
  } else if (description.length > 500) {
    errors.description = "Descripción muy larga (máximo 500 caracteres)";
  }

  // supplier_id (opcional): el proveedor como entidad. Se valida que parezca un
  // uuid; que exista y sea del bufete lo verifica el helper server-side, igual
  // que con chart_account_code.
  let supplierId: string | null = null;
  if (raw.supplier_id != null && String(raw.supplier_id).trim() !== "") {
    const v = String(raw.supplier_id).trim();
    if (!UUID_RE.test(v)) {
      errors.supplier_id = "Proveedor inválido";
    } else {
      supplierId = v;
    }
  }

  // due_date (opcional): si no llega, el helper server-side lo calcula desde el
  // plazo del proveedor. Solo se exige que sea una fecha y que no sea anterior
  // al gasto — un vencimiento previo a la compra no existe.
  let dueDate: string | null = null;
  if (raw.due_date != null && String(raw.due_date).trim() !== "") {
    const v = String(raw.due_date).trim();
    if (!DATE_RE.test(v)) {
      errors.due_date = "Fecha de vencimiento inválida (esperado YYYY-MM-DD)";
    } else if (raw.expense_date && DATE_RE.test(String(raw.expense_date)) && v < String(raw.expense_date)) {
      errors.due_date = "El vencimiento no puede ser anterior a la fecha del gasto";
    } else {
      dueDate = v;
    }
  }

  // supplier_name (opcional, validar longitud si llega)
  let supplierName: string | null = null;
  if (raw.supplier_name != null && String(raw.supplier_name).trim() !== "") {
    const s = String(raw.supplier_name).trim();
    if (s.length > 200) {
      errors.supplier_name = "Nombre de proveedor muy largo (máximo 200 caracteres)";
    } else {
      supplierName = s;
    }
  }

  // supplier_invoice_number (opcional, sólo largo — nunca formato).
  // Mismo criterio que el RUC de proveedores: en Panamá conviven numeraciones
  // de facturación electrónica, talonarios preimpresos y recibos con serie
  // propia. Un validador estricto rechazaría comprobantes legítimos.
  let supplierInvoiceNumber: string | null = null;
  if (raw.supplier_invoice_number != null && String(raw.supplier_invoice_number).trim() !== "") {
    const n = String(raw.supplier_invoice_number).trim();
    if (n.length > 50) {
      errors.supplier_invoice_number = "Número de factura muy largo (máximo 50 caracteres)";
    } else {
      supplierInvoiceNumber = n;
    }
  }

  // supplier_ruc (opcional, validar longitud si llega)
  let supplierRuc: string | null = null;
  if (raw.supplier_ruc != null && String(raw.supplier_ruc).trim() !== "") {
    const s = String(raw.supplier_ruc).trim();
    if (s.length > 50) {
      errors.supplier_ruc = "RUC muy largo (máximo 50 caracteres)";
    } else {
      supplierRuc = s;
    }
  }

  // ---- LÍNEAS ------------------------------------------------------------
  // 🔴 OBLIGATORIAS, Y CON CUENTA. Antes acá había un `chart_account_code`
  //    OPCIONAL en el encabezado; desde la migración `040` la cuenta vive en la
  //    línea y una compra sin cuenta no se puede imputar a nada, así que dejó de
  //    ser opcional. La existencia de la cuenta en el plan la verifica el caller
  //    server-side con un lookup — acá solo el formato y la presencia.
  const lineas: LineaDeCompraInput[] = [];
  const rawLineas = Array.isArray(raw.lineas) ? raw.lineas : [];
  if (rawLineas.length === 0) {
    errors.lineas = "La compra necesita al menos una línea.";
  }
  for (let i = 0; i < rawLineas.length; i++) {
    const l = (rawLineas[i] ?? {}) as unknown as Record<string, unknown>;
    const nro = i + 1;
    const desc = String(l.description ?? "").trim();
    if (desc.length < 3 || desc.length > 300) {
      errors[`lineas.${i}.description`] = `Línea ${nro}: la descripción va de 3 a 300 caracteres.`;
    }
    const code = String(l.chart_account_code ?? "").trim();
    if (code === "") {
      errors[`lineas.${i}.chart_account_code`] = `Línea ${nro}: falta la cuenta contable.`;
    } else if (code.length > 20) {
      errors[`lineas.${i}.chart_account_code`] = `Línea ${nro}: código de cuenta muy largo.`;
    }
    const amount = Number(l.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      errors[`lineas.${i}.amount`] = `Línea ${nro}: el monto tiene que ser mayor que cero.`;
    }
    // El código de impuesto es OBLIGATORIO por línea (migración `045`), igual
    // que en `validators/invoice.ts`. Acá solo la presencia y el formato: que
    // exista, sea de este bufete y esté activo lo resuelve el servidor contra
    // `tax_codes`, y de ahí saca la tasa que de verdad se guarda.
    const taxCodeId = String(l.tax_code_id ?? "").trim();
    if (!UUID_RE.test(taxCodeId)) {
      errors[`lineas.${i}.tax_code_id`] = `Línea ${nro}: elija el impuesto.`;
    }
    // La tasa de la línea se acota al rango que acepta la base
    // (`expense_lines_tax_rate_rango`: 0..1). Es el snapshot que manda la
    // pantalla para mostrar el total sin esperar; el servidor la reemplaza por
    // la del catálogo.
    const lineaTaxRate = Number(l.tax_rate ?? 0);
    if (!Number.isFinite(lineaTaxRate) || lineaTaxRate < 0 || lineaTaxRate > 1) {
      errors[`lineas.${i}.tax_rate`] = `Línea ${nro}: la tasa de ITBMS va de 0 a 1 (0,07 = 7%).`;
    }
    // El ITBMS se acepta como viene del comprobante —un proveedor puede
    // redondear distinto— pero se verifica con tolerancia contra base × tasa,
    // el mismo ±0,02 que `validators/expense-line.ts` aplica en trámite. Hasta
    // el 16/09/2026 compras NO lo verificaba: cualquier importe pasaba.
    const lineaTaxAmount = Number(l.tax_amount ?? 0);
    if (!Number.isFinite(lineaTaxAmount) || lineaTaxAmount < 0) {
      errors[`lineas.${i}.tax_amount`] = `Línea ${nro}: el ITBMS no puede ser negativo.`;
    } else if (Number.isFinite(amount) && amount > 0 && lineaTaxRate >= 0 && lineaTaxRate <= 1) {
      const sugerido = round2(amount * lineaTaxRate);
      // `+ 1e-9`: en coma flotante 1.77 − 1.75 da 0.020000000000000018.
      if (Math.abs(lineaTaxAmount - sugerido) > TOLERANCIA_IMPUESTO_LINEA + 1e-9) {
        errors[`lineas.${i}.tax_amount`] =
          `Línea ${nro}: con esa tasa el ITBMS sería ${sugerido.toFixed(2)}. ` +
          `Corríjalo o cambie el impuesto.`;
      }
    }
    lineas.push({
      description: desc,
      chart_account_code: code === "" ? null : code,
      amount: round2(amount),
      tax_code_id: taxCodeId,
      tax_rate: lineaTaxRate,
      tax_amount: round2(lineaTaxAmount),
    });
  }

  // ---- LOS IMPORTES DEL ENCABEZADO SE DERIVAN DE LAS LÍNEAS --------------
  //
  // 🔴 NO se leen de `raw.subtotal` / `raw.tax_rate` / `raw.tax_amount`. Antes sí:
  //    el encabezado era la fuente de verdad y las líneas no existían. Desde la
  //    migración `040` la verdad está en las líneas, y mantener dos fuentes hacía
  //    que la compra se guardara con importes que no eran la suma de sus partes.
  //
  // ⚠️ Esto NO es cosmético: `business_expenses_tax_consistency_check` acopla los
  //    tres campos del encabezado, y con el valor tipeado a mano rechazaba dos
  //    casos legítimos (medidos contra staging el 09/09/2026):
  //
  //      · Todas las líneas EXENTAS con la tasa del encabezado en 7% —que es el
  //        valor por DEFECTO del formulario— → CHECK rechaza.
  //      · Líneas mixtas con la tasa del encabezado en 0% → CHECK rechaza.
  //
  //    Derivando los tres, los dos casos pasan y el encabezado describe de verdad
  //    al documento. La compra mixta que planteó Josuarth (la factura del
  //    internet: un renglón gravado y uno exento) es el caso central.
  //
  // El servidor vuelve a derivarlos en `createBusinessExpense` sobre las mismas
  // líneas. Que se calcule en los dos lados no es duplicación por descuido: el
  // cliente necesita mostrar el total sin esperar la respuesta, y el servidor no
  // puede confiar en un número que llegó por la red.
  const subtotal = round2(lineas.reduce((acc, l) => acc + l.amount, 0));
  const taxAmount = round2(lineas.reduce((acc, l) => acc + l.tax_amount, 0));
  const taxRateCrudo = derivarTasaDeCabecera(lineas, taxAmount);
  // `normalizeTaxRate` sólo limpia el ruido de coma flotante cuando la tasa
  // derivada ES una de las panameñas; si es otra, se respeta tal cual.
  const taxRate = normalizeTaxRate(taxRateCrudo) ?? taxRateCrudo;

  if (taxAmount > 0 && taxRate === 0) {
    // Hay ITBMS pero ninguna línea declara una tasa. Es incoherente y el CHECK
    // de la base lo rechazaría con un mensaje crudo; se corta acá con uno claro.
    errors.tax_amount =
      "Hay ITBMS cargado pero ninguna línea tiene tasa. Revise la tasa de las líneas gravadas.";
  }

  // status. En el alta es la INTENCIÓN: 'pagado' = registrar el pago al crear,
  // y entonces el banco es obligatorio (048: el banco vive en el pago).
  // 'parcialmente_pagado' lo deriva el trigger; no se manda.
  const status = raw.status as BusinessExpenseStatus | undefined;
  if (!status || !VALID_STATUSES.includes(status) || status === "parcialmente_pagado") {
    errors.status = "Estado inválido";
  }
  let paymentAccountCode: string | null = null;
  if (status === "pagado") {
    const rawCta = (raw as { payment_account_code?: unknown }).payment_account_code;
    if (rawCta == null || String(rawCta).trim() === "") {
      errors.payment_account_code = "Elija la cuenta bancaria de donde salió el pago.";
    } else if (String(rawCta).trim().length > 20) {
      errors.payment_account_code = "Código de cuenta muy largo";
    } else {
      paymentAccountCode = String(rawCta).trim();
    }
  }

  // payment_date — si llega, validar formato; coherencia con status
  let paymentDate: string | null = null;
  if (raw.payment_date != null && String(raw.payment_date).trim() !== "") {
    if (!DATE_RE.test(String(raw.payment_date))) {
      errors.payment_date = "Fecha de pago inválida (esperado YYYY-MM-DD)";
    } else {
      paymentDate = String(raw.payment_date);
    }
  }
  // CHECK payment_date_consistency: pendiente_pago ⇒ payment_date NULL
  if (status === "pendiente_pago" && paymentDate !== null) {
    errors.payment_date = "Una compra pendiente de pago no puede tener fecha de pago";
  }

  // payment_method (opcional)
  let paymentMethod: BusinessExpensePaymentMethod | null = null;
  if (raw.payment_method != null && String(raw.payment_method).trim() !== "") {
    const pm = raw.payment_method as BusinessExpensePaymentMethod;
    if (!VALID_PAYMENT_METHODS.includes(pm)) {
      errors.payment_method = "Método de pago inválido";
    } else {
      paymentMethod = pm;
    }
  }
  // Si está pendiente_pago, descartamos payment_method silenciosamente
  // (la UI ya lo oculta cuando status='pendiente_pago').
  if (status === "pendiente_pago") {
    paymentMethod = null;
  }

  // notes (opcional)
  let notes: string | null = null;
  if (raw.notes != null && String(raw.notes).trim() !== "") {
    const n = String(raw.notes).trim();
    if (n.length > 2000) {
      errors.notes = "Nota muy larga (máximo 2000 caracteres)";
    } else {
      notes = n;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, data: null, errors };
  }

  return {
    ok: true,
    errors: null,
    data: {
      expense_date: raw.expense_date as string,
      due_date: dueDate,
      supplier_id: supplierId,
      supplier_name: supplierName,
      supplier_ruc: supplierRuc,
      supplier_invoice_number: supplierInvoiceNumber,
      lineas,
      description,
      subtotal: round2(subtotal),
      tax_rate: taxRate as BusinessExpenseTaxRate,
      tax_amount: round2(taxAmount),
      status: status as BusinessExpenseStatus,
      payment_date: paymentDate,
      payment_method: paymentMethod,
      payment_account_code: paymentAccountCode,
      notes,
    },
  };
}

/** Valida un payload de actualización. Igual a create. */
export function validateUpdateBusinessExpense(
  raw: Partial<CreateBusinessExpenseInput>
) {
  return validateCreateBusinessExpense(raw);
}

/**
 * POR QUÉ NO SE GUARDÓ, EN UNA FRASE.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ESTO EXISTE POR UN RECHAZO MUDO
 * ═════════════════════════════════════════════════════════════════════════════
 * El 10/09/2026 se vio en el smoke test: guardar una compra con una línea sin
 * cuenta **no guardaba y no decía nada**. El validador SÍ producía el error
 * (`lineas.0.chart_account_code`) y el editor de líneas SÍ sabe pintarlo — pero
 * el formulario de compras nunca le pasaba `errors` al editor, así que el
 * mensaje se calculaba y se tiraba. Gastos de trámite sí lo pasaba.
 *
 * Se arregló el prop, y además se agregó este resumen: es el mismo patrón que
 * `estadoDelRegistro()` del asiento manual (SOP-027). Un error de campo puede
 * quedar fuera de la pantalla —las líneas están abajo—; la frase al lado del
 * botón dice qué pasó sin obligar a buscar el borde rojo.
 *
 * ⚠️ Devuelve UN motivo, el próximo paso, y **nombra la línea**. Los errores de
 *    línea van primero porque son los que quedan lejos del botón.
 */
export function motivoParaNoGuardar(errors: ValidationErrors): string | null {
  const claves = Object.keys(errors);
  if (claves.length === 0) return null;

  // — errores de línea, en orden de aparición en la pantalla —
  const deLinea = claves
    .map((k) => {
      const m = k.match(/^lineas\.(\d+)\.(.+)$/);
      return m ? { i: Number(m[1]), campo: m[2], clave: k } : null;
    })
    .filter((x): x is { i: number; campo: string; clave: string } => x !== null)
    .sort((a, b) => a.i - b.i || a.campo.localeCompare(b.campo));

  if (deLinea.length > 0) {
    const primero = deLinea[0];
    const linea = primero.i + 1;
    const otras = new Set(deLinea.map((x) => x.i));
    const sufijo =
      otras.size > 1 ? ` (y ${otras.size - 1} línea(s) más con datos por revisar)` : "";

    if (primero.campo === "chart_account_code") {
      return `Elegí la cuenta contable de la línea ${linea}.${sufijo}`;
    }
    return `Revise la línea ${linea}: ${errors[primero.clave]}${sufijo}`;
  }

  // — errores del encabezado: el mensaje del validador ya está redactado —
  const general = errors["lineas"];
  if (general) return general;
  return errors[claves[0]] ?? "Revise los campos marcados en rojo.";
}
