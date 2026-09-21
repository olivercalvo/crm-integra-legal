/**
 * Helpers server-side para mutaciones de business_expenses. Llamados desde
 * route handlers `/api/finanzas/business-expenses/...`. Mismo patrón que
 * api/invoices.ts: admin client (bypass RLS) + filter manual por tenant_id +
 * MutationError para errores con código HTTP sugerido.
 *
 * Cada mutación graba en audit_log con (entity='business_expenses',
 * action='create|update|delete').
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CreateBusinessExpenseInput,
  UpdateBusinessExpenseInput,
} from "@/lib/finanzas/types/business-expense";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";
import { resolverCodigosDeImpuesto } from "@/lib/finanzas/api/tax-codes";
import { formatTaxRate } from "@/lib/finanzas/types/tax-code";
import { validarCuentaDeGasto } from "@/lib/finanzas/queries/business-expenses";
import { vencimientoPorPlazo } from "@/lib/finanzas/types/supplier";
import type { AsientoInput } from "@/lib/finanzas/contabilidad/posting";
import { postJournalEntry } from "@/lib/finanzas/contabilidad/posting";
import {
  construirAsientoDeCompra,
  SOURCE_TYPE_COMPRA,
} from "@/lib/finanzas/contabilidad/asiento-compra";
import { cargarCompraParaAsiento } from "@/lib/finanzas/queries/compra-para-asiento";
import { createSupplierPayment } from "@/lib/finanzas/api/supplier-payments";

/** Centavos, y una sola vez. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Tolerancia (B/.) del ITBMS de una línea contra `amount × tasa del catálogo`.
 * El comprobante manda y un proveedor puede redondear distinto; ±0,02 es el
 * mismo margen que el validador de trámite (`validators/expense-line.ts`).
 */
const TOLERANCIA_ITBMS = 0.02;

type DB = SupabaseClient;

const ENTITY = "business_expenses";

/**
 * Los importes del ENCABEZADO, derivados de las líneas. Una sola regla, usada
 * por el alta y por la edición.
 *
 * 🔴 No se leen del input aunque vengan: si un cliente pudiera mandar un total
 *    que no es la suma de las líneas, el asiento no cuadraría contra su propio
 *    documento. El validador los deriva también, para que la pantalla muestre el
 *    total sin esperar la respuesta; acá se vuelve a hacer porque el servidor no
 *    puede confiar en un número que llegó por la red.
 *
 * ⚠️ `tax_rate` es el que más importa, y es el que antes NO se derivaba.
 *    `business_expenses_tax_consistency_check` acopla los tres campos, y con la
 *    tasa tipeada a mano en el encabezado rechazaba dos casos legítimos
 *    (medidos contra staging el 09/09/2026): todas las líneas exentas con la
 *    tasa por defecto en 7%, y líneas mixtas con la tasa en 0%. Ver
 *    `validators/business-expense.ts`, que documenta la regla completa.
 */
function importesDelEncabezado(lineas: { amount: number; tax_rate: number; tax_amount: number }[]) {
  const subtotal = round2(lineas.reduce((a, l) => a + l.amount, 0));
  const taxAmount = round2(lineas.reduce((a, l) => a + l.tax_amount, 0));
  const gravadas = lineas.filter((l) => l.tax_amount > 0).map((l) => l.tax_rate);
  const taxRate = taxAmount > 0 && gravadas.length > 0 ? Math.max(...gravadas) : 0;
  return { subtotal, taxAmount, taxRate };
}

/**
 * El vencimiento que le corresponde a un gasto.
 *
 * Si el formulario mandó uno, manda ese: lo que diga el comprobante gana sobre
 * el plazo del proveedor. Si no, se calcula desde el plazo del proveedor, y si
 * tampoco hay proveedor se asume contado (vence el mismo día).
 *
 * Está acá y no en el validador porque necesita leer el plazo de la base.
 */
async function resolverVencimiento(
  db: DB,
  tenantId: string,
  input: { due_date: string | null; supplier_id: string | null; expense_date: string }
): Promise<string> {
  if (input.due_date) return input.due_date;

  if (input.supplier_id) {
    const { data } = await db
      .from("suppliers")
      .select("payment_terms_days")
      .eq("tenant_id", tenantId)
      .eq("id", input.supplier_id)
      .maybeSingle();
    if (data) {
      return vencimientoPorPlazo(input.expense_date, Number(data.payment_terms_days ?? 0));
    }
  }
  return input.expense_date;
}

/** Que el proveedor exista y sea de este bufete. La FK no alcanza: es global. */
async function proveedorValido(db: DB, tenantId: string, id: string): Promise<boolean> {
  const { data } = await db
    .from("suppliers")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  return !!data;
}


/**
 * 🔴 GATE CONTABLE — una compra que ya está en el libro no se edita ni se borra.
 *
 * Mismo patrón que `cancelInvoice` (`api/invoices.ts`), y por el mismo motivo:
 * el asiento es INMUTABLE. Si la compra cambia de monto, de cuenta o de fecha, o
 * si desaparece, el asiento sigue en el libro tal cual, y el documento deja de
 * respaldarlo. Un contador que audite el mayor llega a una compra que dice otra
 * cosa — o a ninguna.
 *
 * Corregir una compra contabilizada requiere un asiento de REVERSIÓN, que es su
 * propio bloque y todavía necesita decidir con qué fecha se revierte.
 *
 * ⚠️ Hasta el 04/09/2026 este gate NO existía en compras: `update` y `delete`
 * podían tocar libremente una compra con asiento, y las tres compras sembradas
 * en staging ya tenían el suyo. El agujero estaba abierto, no era teórico.
 */
async function gateContable(db: DB, tenantId: string, id: string, verbo: string) {
  const { data: asiento } = await db
    .from("journal_entries")
    .select("entry_number")
    .eq("tenant_id", tenantId)
    .eq("source_type", SOURCE_TYPE_COMPRA)
    .eq("source_id", id)
    .maybeSingle();

  if (asiento) {
    const numero = (asiento as { entry_number: number }).entry_number;
    throw new MutationError(
      `Esta compra ya está registrada en el libro contable (asiento ${numero}), ` +
        `así que no se puede ${verbo}. Los asientos son inmutables por ley. ` +
        `La corrección de compras contabilizadas se habilita junto con el asiento ` +
        `de reversión.`,
      409
    );
  }
}

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

/**
 * Registra una compra del bufete **y su asiento contable**.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 REGISTRAR → POSTEAR → DESHACER EL REGISTRO SI EL POSTEO FALLA
 * ═════════════════════════════════════════════════════════════════════════════
 * **No es "postear antes de registrar"**, que es lo que hace `emitInvoice` con
 * las facturas, y decirlo así acá sería falso. Una compra no tiene ciclo
 * borrador → emitir: nace registrada en el mismo INSERT que la crea. Y el
 * `source_id` del asiento **es** el id de la compra, que no existe hasta después
 * de ese INSERT. Postear antes es literalmente imposible.
 *
 * Entonces el orden real es:
 *
 *   1. INSERT de la compra (y de sus líneas)
 *   2. Postear el asiento
 *   3. Si el posteo falla → **DELETE compensatorio** de la compra
 *
 * El efecto visible para quien usa el sistema es el mismo que en la factura —una
 * compra que no se pudo contabilizar no queda registrada— pero la mecánica es
 * otra, y quien lea esto tiene que saber cuál es.
 *
 * ⚠️ El DELETE compensatorio es seguro acá **porque `business_expenses` NO es
 * inmutable**. En `journal_entries` sería imposible: los triggers de la `023`
 * rechazan DELETE, y por eso el ledger se escribe con un RPC que hace todo
 * adentro. Es el mismo patrón que `credit-notes.ts` usa para las líneas de una
 * nota de crédito.
 *
 * ⚠️ Si el DELETE compensatorio **también** falla, se registra en el log y se
 * lanza el error del posteo, no el del DELETE: lo que la persona necesita saber
 * es por qué no se contabilizó. La compra huérfana queda, y es detectable con
 * una consulta (compras sin asiento) — que es justamente el caso reversible.
 */
export async function createBusinessExpense(
  db: DB,
  tenantId: string,
  userId: string,
  input: CreateBusinessExpenseInput,
  ledgerDb: DB
) {
  // ---- Las líneas, y su cuenta ------------------------------------------
  // 🔑 La cuenta es OBLIGATORIA acá, en el servidor, además de serlo en el
  //    formulario. El formulario guía; el servidor garantiza. Un `curl` saltea
  //    la pantalla, y una compra sin cuenta no se puede imputar a nada.
  if (input.lineas.length === 0) {
    throw new MutationError("La compra necesita al menos una línea.", 400);
  }

  // Validación cross-tabla POR LÍNEA: la cuenta debe existir, estar activa y ser
  // de un tipo que pueda recibir un desembolso — gasto, costo o ACTIVO, que es
  // lo que pide el acta del 25/08 ("la cuenta de gasto, costo o activo que elija
  // el usuario"). La FK es lógica (no hay constraint de BD), por eso se verifica
  // a mano. Se recorren TODAS y se informa la primera que falla, nombrando su
  // número de línea: con varias líneas, "la cuenta X está inactiva" sin decir
  // cuál línea obliga a adivinar.
  for (let i = 0; i < input.lineas.length; i++) {
    const l = input.lineas[i];
    const nro = i + 1;
    if (!l.chart_account_code) {
      throw new MutationError(
        `La línea ${nro} ("${l.description}") no tiene cuenta contable. ` +
          `Cada línea de una compra tiene que decir contra qué cuenta se imputa.`,
        400
      );
    }
    // Distingue "no existe" de "existe pero está inactiva": son dos errores
    // distintos, y el segundo tiene que explicar POR QUÉ o la persona vuelve a
    // elegir la misma cuenta del plan viejo.
    const veredicto = await validarCuentaDeGasto(db, tenantId, l.chart_account_code);
    if (veredicto.estado === "no-existe") {
      throw new MutationError(
        `Línea ${nro}: la cuenta contable "${l.chart_account_code}" no existe en el Plan de Cuentas.`,
        400
      );
    }
    // El tipo se informa con su MOTIVO, que ya viene redactado desde
    // `cuentas-de-gasto.ts`. Antes este caso caía en "no existe o no es de tipo
    // gasto": el mensaje mandaba a buscar la cuenta en el plan cuando la cuenta
    // estaba ahí y el problema era otro.
    if (veredicto.estado === "tipo-invalido") {
      throw new MutationError(`Línea ${nro}: ${veredicto.mensaje}`, 400);
    }
    if (veredicto.estado === "inactiva") {
      throw new MutationError(
        `Línea ${nro}: la cuenta "${l.chart_account_code}" está inactiva en el Plan de ` +
          `Cuentas: es del plan contable anterior y no se puede usar para clasificar ` +
          `gastos nuevos. Seleccione una cuenta activa.`,
        400
      );
    }
  }

  if (input.supplier_id !== null && !(await proveedorValido(db, tenantId, input.supplier_id))) {
    throw new MutationError("El proveedor seleccionado no existe.", 400);
  }
  const dueDate = await resolverVencimiento(db, tenantId, input);

  // 🔴 LA TASA DE CADA LÍNEA SALE DEL CATÁLOGO, NO DEL BODY (migración `045`).
  //    El body trae `tax_code_id` (qué eligió la persona) y `tax_rate` (lo que
  //    la pantalla usó para mostrar el total). Se le cree al id, nunca a la
  //    tasa: se resuelve contra `tax_codes` —tenant, activo— y el snapshot que
  //    se guarda es el del catálogo. Si el body trajera 7% con un id de EXENTO,
  //    la línea se guarda exenta, y el ITBMS tecleado se rechaza abajo por no
  //    calzar con la tasa real.
  const codigos = await resolverCodigosDeImpuesto(
    db,
    tenantId,
    input.lineas.map((l) => l.tax_code_id)
  );
  const lineas = input.lineas.map((l, i) => {
    const codigo = codigos.get(l.tax_code_id);
    if (!codigo) {
      // `resolverCodigosDeImpuesto` ya rechazó los que faltan; esto es el tipo.
      throw new MutationError(`Línea ${i + 1}: el impuesto elegido no está en el catálogo.`, 400);
    }
    const esperado = round2(l.amount * codigo.rate);
    if (Math.abs(l.tax_amount - esperado) > TOLERANCIA_ITBMS + 1e-9) {
      throw new MutationError(
        `Línea ${i + 1} ("${l.description}"): el impuesto elegido es ${codigo.code} ` +
          `(${formatTaxRate(codigo.rate)}), así que el ITBMS ` +
          `sería ${esperado.toFixed(2)} y no ${l.tax_amount.toFixed(2)}. Corrija el ` +
          `importe o cambie el impuesto.`,
        400
      );
    }
    return { ...l, tax_rate: codigo.rate };
  });

  // Los totales del encabezado los calcula el SERVIDOR sumando las líneas, no
  // llegan del cliente: si llegaran, un cliente podría mandar un total que no
  // es la suma y el asiento no cuadraría contra su propio documento.
  const { subtotal, taxAmount, taxRate } = importesDelEncabezado(lineas);

  const { data, error } = await db
    .from("business_expenses")
    .insert({
      tenant_id: tenantId,
      expense_date: input.expense_date,
      due_date: dueDate,
      supplier_id: input.supplier_id,
      supplier_name: input.supplier_name,
      supplier_ruc: input.supplier_ruc,
      supplier_invoice_number: input.supplier_invoice_number,
      // 🔴 SIEMPRE null: la cuenta vive en la línea desde la migración `040`, y
      //    el CHECK `business_expenses_cuenta_vive_en_la_linea` rechaza otra
      //    cosa. No se lee `input.chart_account_code` a propósito.
      chart_account_code: null,
      description: input.description,
      subtotal,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      // 🔴 Una compra NACE pendiente: `status`, `amount_paid` y `payment_date`
      //    los deriva el trigger de la 048 desde `supplier_payments`, y el
      //    guard rechaza otra cosa. "Ya está pagada" en el alta significa
      //    registrar el PAGO después de crearla (abajo), no nacer pagada.
      status: "pendiente_pago",
      payment_date: null,
      payment_method: input.payment_method,
      notes: input.notes,
      created_by: userId,
    })
    .select("id, total")
    .single();

  if (error || !data) {
    console.error("[finanzas/api] createBusinessExpense failed", error);
    throw new MutationError(pgErrorToMessage(error), 500, error);
  }

  const compraId = data.id as string;

  /** Deshace el registro. Ver el encabezado: por qué se puede y por qué acá sí. */
  async function deshacerRegistro(causa: unknown) {
    const { error: errDel } = await db
      .from("business_expenses")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", compraId);
    if (errDel) {
      // No se pisa el error original: lo que hace falta explicar es por qué no
      // se contabilizó. La compra huérfana queda registrada en el log.
      console.error(
        "[finanzas/api] DELETE compensatorio FALLÓ para la compra %s. Quedó registrada sin asiento.",
        compraId,
        errDel
      );
    }
    throw causa;
  }

  // ---- Las líneas -------------------------------------------------------
  const { error: errLineas } = await db.from("expense_lines").insert(
    lineas.map((l, i) => ({
      tenant_id: tenantId,
      business_expense_id: compraId,
      line_order: i + 1,
      description: l.description,
      chart_account_code: l.chart_account_code,
      amount: l.amount,
      tax_code_id: l.tax_code_id,
      // Snapshot de `tax_codes.rate`, resuelto arriba. No es el del body.
      tax_rate: l.tax_rate,
      tax_amount: l.tax_amount,
    }))
  );
  if (errLineas) {
    console.error("[finanzas/api] insert de expense_lines falló", errLineas);
    await deshacerRegistro(new MutationError(pgErrorToMessage(errLineas), 500, errLineas));
  }

  // ---- EL ASIENTO -------------------------------------------------------
  const compra = await cargarCompraParaAsiento(ledgerDb, tenantId, compraId);
  if (!compra) {
    await deshacerRegistro(
      new MutationError("La compra se registró pero no se pudo releer para contabilizarla.", 500)
    );
  }

  const armado = construirAsientoDeCompra(compra as NonNullable<typeof compra>);
  if (!armado.ok) {
    // 422: la compra está bien formada como documento; lo que está mal es la
    // clasificación contable de una línea. El mensaje ya nombra cuál.
    await deshacerRegistro(new MutationError(armado.mensaje, 422));
  }

  try {
    await postJournalEntry(
      ledgerDb,
      tenantId,
      (armado as { ok: true; asiento: AsientoInput }).asiento,
      userId
    );
  } catch (err) {
    // El asiento ya existía: solo puede pasar si este mismo `compraId` ya se
    // posteó, y como el id lo acaba de generar el INSERT, es prácticamente
    // imposible. Se trata igual que cualquier otro fallo —deshacer— en vez de
    // dejarlo pasar como en `emitInvoice`: allá el reintento era de un documento
    // que YA existía; acá la compra es nueva, así que un choque significa que
    // algo está mal, no que se reintentó.
    await deshacerRegistro(err);
  }

  await db.from("audit_log").insert({
    tenant_id: tenantId,
    user_id: userId,
    entity: ENTITY,
    entity_id: data.id as string,
    action: "create",
    field: null,
    old_value: null,
    new_value: JSON.stringify({
      expense_date: input.expense_date,
      description: input.description,
      subtotal,
      tax_amount: taxAmount,
      status: input.status,
      lineas: input.lineas.length,
      cuentas: input.lineas.map((l) => l.chart_account_code),
      supplier_name: input.supplier_name,
    }),
  });

  // ---- "YA ESTÁ PAGADA": el pago, DESPUÉS de la compra --------------------
  // Si el alta dice `status: "pagado"`, se registra un pago por el total con
  // los datos del alta (fecha, método, banco). Si el pago falla, la compra
  // queda registrada y PENDIENTE —que es la verdad— y el error lo dice, con el
  // id, para que la pantalla lleve al detalle y se registre desde ahí.
  let pago: { id: string; payment_number: string } | null = null;
  if (input.status === "pagado") {
    try {
      pago = await createSupplierPayment(
        db,
        tenantId,
        userId,
        {
          business_expense_id: compraId,
          payment_date: input.payment_date ?? input.expense_date,
          amount: Number(data.total),
          method: input.payment_method ?? "transferencia",
          payment_account_code: input.payment_account_code ?? null,
          reference: null,
          notes: null,
        },
        ledgerDb
      );
    } catch (err) {
      const motivo = err instanceof MutationError ? err.message : String(err);
      throw new MutationError(
        `La compra se registró y quedó PENDIENTE DE PAGO, pero el pago no se pudo registrar: ${motivo} ` +
          `Regístrelo desde el detalle de la compra.`,
        err instanceof MutationError ? err.status : 500,
        { compra_id: compraId, sin_pago: true }
      );
    }
  }

  return { id: compraId, total: Number(data.total), pago };
}

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------

export async function updateBusinessExpense(
  db: DB,
  tenantId: string,
  id: string,
  userId: string,
  input: UpdateBusinessExpenseInput
) {
  // Verificar existencia + tenant ownership (defensa en profundidad sobre RLS).
  const { data: existing, error: errExisting } = await db
    .from("business_expenses")
    .select(
      `id, expense_date, due_date, supplier_id, supplier_name, supplier_ruc,
       supplier_invoice_number,
       chart_account_code, description, subtotal, tax_rate, tax_amount,
       status, payment_date, payment_method, notes`
    )
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (errExisting) {
    throw new MutationError(pgErrorToMessage(errExisting), 500, errExisting);
  }
  if (!existing) {
    throw new MutationError("Gasto no encontrado", 404);
  }

  await gateContable(db, tenantId, id, "editar");

  // La cuenta ya NO vive acá: desde la migración `040` está en
  // `expense_lines.chart_account_code`, una por línea, y un CHECK fuerza esta
  // columna a NULL. La validación de cuenta que había en este punto quedó sin
  // objeto y se eliminó — dejarla habría sido validar un campo que ya nadie
  // escribe.

  if (input.supplier_id !== null && !(await proveedorValido(db, tenantId, input.supplier_id))) {
    throw new MutationError("El proveedor seleccionado no existe.", 400);
  }
  const dueDateUpdate = await resolverVencimiento(db, tenantId, input);
  const importesEditados = importesDelEncabezado(input.lineas);

  const { error: errUpdate } = await db
    .from("business_expenses")
    .update({
      expense_date: input.expense_date,
      due_date: dueDateUpdate,
      supplier_id: input.supplier_id,
      supplier_name: input.supplier_name,
      supplier_ruc: input.supplier_ruc,
      supplier_invoice_number: input.supplier_invoice_number,
      // Sigue en NULL: la cuenta vive en la línea (migración `040`).
      chart_account_code: null,
      description: input.description,
      subtotal: importesEditados.subtotal,
      tax_rate: importesEditados.taxRate,
      tax_amount: importesEditados.taxAmount,
      // `status` y `payment_date` NO se escriben: los deriva el trigger de la
      // 048 desde los pagos, y el guard rechaza cambiarlos a mano. Para pagar,
      // se registra un pago; para "despagar", se elimina o reversa.
      payment_method: input.payment_method,
      notes: input.notes,
    })
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (errUpdate) {
    console.error("[finanzas/api] updateBusinessExpense failed", errUpdate);
    throw new MutationError(pgErrorToMessage(errUpdate), 500, errUpdate);
  }

  // Audit log: diff de campos modificados
  const fields = [
    "expense_date", "supplier_name", "supplier_ruc", "supplier_invoice_number",
    "chart_account_code",
    "description", "subtotal", "tax_rate", "tax_amount",
    "status", "payment_date", "payment_method", "notes",
  ] as const;
  const changed: Record<string, { old: unknown; new: unknown }> = {};
  for (const f of fields) {
    const oldVal = (existing as unknown as Record<string, unknown>)[f];
    const newVal = (input as unknown as Record<string, unknown>)[f];
    // Comparar normalizando NUMERIC string vs number
    const oldNorm = typeof oldVal === "string" && /^-?\d+(\.\d+)?$/.test(oldVal) ? Number(oldVal) : oldVal;
    const newNorm = typeof newVal === "string" && /^-?\d+(\.\d+)?$/.test(newVal) ? Number(newVal) : newVal;
    if (oldNorm !== newNorm) {
      changed[f] = { old: oldVal, new: newVal };
    }
  }

  if (Object.keys(changed).length > 0) {
    await db.from("audit_log").insert({
      tenant_id: tenantId,
      user_id: userId,
      entity: ENTITY,
      entity_id: id,
      action: "update",
      field: Object.keys(changed).join(","),
      old_value: JSON.stringify(Object.fromEntries(
        Object.entries(changed).map(([k, v]) => [k, v.old])
      )),
      new_value: JSON.stringify(Object.fromEntries(
        Object.entries(changed).map(([k, v]) => [k, v.new])
      )),
    });
  }

  return { id };
}

// ---------------------------------------------------------------------------
// DELETE (hard delete + cleanup de receipt en storage)
// ---------------------------------------------------------------------------

export async function deleteBusinessExpense(
  db: DB,
  tenantId: string,
  id: string,
  userId: string
) {
  const { data: existing, error: errExisting } = await db
    .from("business_expenses")
    .select("id, receipt_url, description, expense_date, subtotal, tax_amount")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (errExisting) {
    throw new MutationError(pgErrorToMessage(errExisting), 500, errExisting);
  }
  if (!existing) {
    throw new MutationError("Gasto no encontrado", 404);
  }

  // ANTES de tocar el storage: si el borrado no va a poder completarse, no hay
  // que haber borrado ya el comprobante.
  await gateContable(db, tenantId, id, "borrar");

  // Y una compra CON PAGOS no se borra (la FK es NO ACTION y fallaría igual,
  // pero con un mensaje opaco): primero se eliminan (sin asiento) o se
  // reversan (con asiento) los pagos.
  const { count: pagos } = await db
    .from("supplier_payments")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("business_expense_id", id);
  if ((pagos ?? 0) > 0) {
    throw new MutationError(
      `Esta compra tiene ${pagos} pago${pagos === 1 ? "" : "s"} registrado${pagos === 1 ? "" : "s"}. ` +
        `Elimine o reverse los pagos antes de borrar la compra.`,
      409
    );
  }

  // Borrar receipt del storage si existe (consistente con expenses legacy).
  if (existing.receipt_url) {
    await db.storage.from("documents").remove([existing.receipt_url as string]);
  }

  const { error: errDelete } = await db
    .from("business_expenses")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (errDelete) {
    console.error("[finanzas/api] deleteBusinessExpense failed", errDelete);
    throw new MutationError(pgErrorToMessage(errDelete), 500, errDelete);
  }

  await db.from("audit_log").insert({
    tenant_id: tenantId,
    user_id: userId,
    entity: ENTITY,
    entity_id: id,
    action: "delete",
    field: null,
    old_value: JSON.stringify({
      description: existing.description,
      expense_date: existing.expense_date,
      subtotal: existing.subtotal,
      tax_amount: existing.tax_amount,
    }),
    new_value: null,
  });

  return { id };
}

// ---------------------------------------------------------------------------
// MARK AS PAID — ELIMINADO (Bloque 3, 21/09/2026)
// ---------------------------------------------------------------------------
// `markBusinessExpenseAsPaid` modelaba el pago como un cambio de estado de la
// compra y escribía `business_expenses.payment_account_code`, columna que la
// tabla no tiene (FND-009). Desde la 048 el pago es una entidad:
// `createSupplierPayment` en `api/supplier-payments.ts`, con el banco en el
// pago, pago parcial, y el trigger derivando `status` y `amount_paid`.
