/**
 * «REGISTRAR FACTURA EMITIDA FUERA» (05/10/2026, migración `092`).
 *
 * Una factura que la DGI YA AUTORIZÓ desde otro punto de facturación
 * (QuickBooks 050, portal 100) entra al CRM para que esté en ventas, ITBMS,
 * cuentas por cobrar, antigüedad y el libro, igual que una del CRM. Casos que
 * la trajeron: las 3 del punto 100 (MEI Tower 1C y 2B, Mi Condado) y, si
 * Josuarth lo prefiere, los 7 de QuickBooks del 01 al 03/07.
 * Diseño: `docs/finanzas/propuesta-facturas-emitidas-fuera.md`.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 NUNCA VA AL PAC Y NUNCA GASTA CORRELATIVO DEL 051
 * ═════════════════════════════════════════════════════════════════════════════
 * Este módulo no importa nada de `efactura/orchestration` ni de
 * `efactura/secuencias`. Lo fija `factura-externa-nunca-al-pac.test.ts`. La base
 * lo sostiene además: el guard de la `092` congela `fe_estado` de una factura
 * externa, y todo envío al PAC empieza pasándola a `pending`.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 UNA SOLA TRANSACCIÓN
 * ═════════════════════════════════════════════════════════════════════════════
 * Número `FAC-EXT-`, factura, líneas, asiento y CUFE van dentro del RPC
 * `register_external_invoice`. Si algo falla no queda nada: ni la factura, ni
 * el asiento, ni un hueco en la serie. A diferencia de `emitInvoice`, acá no
 * existe la ventana «emitida sin CUFE» en la que alguien podía apretar
 * «Enviar a la DGI» y crear un segundo documento fiscal por la misma venta.
 *
 * El asiento lo arma `construirAsientoDeFactura` —el MISMO de una factura del
 * CRM— y la base lo verifica cuenta por cuenta. El número todavía no existe
 * cuando se arma, así que viaja como `{numero}` y el RPC lo reemplaza.
 *
 * Quién: admin y contador (Oliver, 05/10/2026). La abogada no: registra una
 * venta en el libro sin emitir nada, y eso es trabajo de cierre contable.
 */

import { asegurarFechaDesdeElInicio } from "@/lib/finanzas/contabilidad/inicio-contable";
import type { SupabaseClient } from "@supabase/supabase-js";

import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";
import { resolverFechaDeRegistro } from "@/lib/finanzas/api/fecha-de-registro";
import { validarLineasContraKind } from "@/lib/finanzas/api/invoices";
import { construirAsientoDeFactura } from "@/lib/finanzas/contabilidad/asiento-factura";
import { resolverLineasParaAsiento } from "@/lib/finanzas/queries/factura-para-asiento";
import { totalesDeLineas, type FacturaExternaInput } from "@/lib/finanzas/validators/factura-externa";
import { facturaConElCufe, mensajeDeCufeRepetido } from "@/lib/finanzas/api/cufe-unico";

type DB = SupabaseClient;

/** Lo que ocupa el lugar del número en el asiento hasta que el RPC lo toma. */
export const MARCA_DEL_NUMERO = "{numero}";

export interface FacturaExternaRegistrada {
  id: string;
  invoice_number: string;
  total: number;
  entry_number: number;
}

/**
 * @param db        Cliente de la sesión: lecturas de catálogo y del período.
 * @param ledgerDb  Cliente de SERVICIO (`createAdminClient(usuario)`): el RPC es
 *                  sólo de `service_role` y el usuario viaja a la bitácora.
 * @param tenantId  Del PERFIL del usuario, nunca del body (SOP-014).
 */
export async function registrarFacturaExterna(
  db: DB,
  ledgerDb: DB,
  tenantId: string,
  userId: string,
  input: FacturaExternaInput
): Promise<FacturaExternaRegistrada> {
  // 1. El cliente: el mismo gate que una factura del CRM.
  const { data: cliente, error: errCli } = await db
    .from("clients")
    .select("id, name, client_status")
    .eq("tenant_id", tenantId)
    .eq("id", input.client_id)
    .maybeSingle();
  if (errCli) throw new MutationError(pgErrorToMessage(errCli), 500, errCli);
  if (!cliente) throw new MutationError("Cliente no encontrado", 404, undefined, { client_id: "Cliente no encontrado" });
  const c = cliente as { id: string; name: string; client_status: string };
  if (c.client_status !== "active") {
    const m = "El cliente tiene que estar activo (con sus datos completos) para registrarle una factura.";
    throw new MutationError(m, 400, undefined, { client_id: m });
  }

  // 2. Las líneas, contra el tipo (SOP-029): la misma regla que una factura del CRM.
  await validarLineasContraKind(db, tenantId, input.invoice_kind, input.lines);

  // 2.b 096 (regla 3.3.5): tampoco una factura emitida fuera con fecha anterior al
  //     inicio contable. Antes del RPC (que toma el número y postea).
  await asegurarFechaDesdeElInicio(db, tenantId, "factura_externa", input.issue_date, "issue_date");

  // 3. Un CUFE, una factura. La base lo vuelve a exigir con un índice único;
  //    esto es para decirlo en el campo, nombrando la factura que ya lo tiene.
  const yaEsta = await facturaConElCufe(db, tenantId, input.cufe);
  if (yaEsta) {
    const m = mensajeDeCufeRepetido(yaEsta);
    throw new MutationError(m, 409, undefined, { cufe: m });
  }

  // 4. La fecha de REGISTRO: la elige el contador (por defecto la del
  //    documento), en un período abierto y nunca en el futuro.
  const fechaDeRegistro = await resolverFechaDeRegistro(db, tenantId, input.accounting_date, {
    que: "la factura",
    campo: "accounting_date",
  });

  // 5. El asiento, con el MISMO constructor que una factura del CRM.
  const lineasParaAsiento = await resolverLineasParaAsiento(
    db,
    tenantId,
    input.lines.map((l, i) => {
      const sub = Number(l.quantity) * Number(l.unit_price);
      return {
        line_order: i,
        description: l.description,
        subtotal: sub,
        tax_amount: sub * Number(l.tax_rate),
        service_id: l.service_id,
        tax_code_id: l.tax_code_id,
      };
    })
  );
  const totales = totalesDeLineas(input.lines);
  const armado = construirAsientoDeFactura({
    id: "pendiente",
    invoice_number: MARCA_DEL_NUMERO,
    issue_date: input.issue_date,
    accounting_date: fechaDeRegistro,
    grand_total: totales.total,
    client_name: c.name,
    client_id: c.id,
    lineas: lineasParaAsiento,
  });
  if (!armado.ok) {
    throw new MutationError(armado.mensaje.replace(`la factura ${MARCA_DEL_NUMERO}`, "esta factura"), 422);
  }

  // 6. Todo lo demás, en una transacción.
  const { data, error } = await ledgerDb.rpc("register_external_invoice", {
    p_tenant_id: tenantId,
    p_client_id: c.id,
    p_invoice_kind: input.invoice_kind,
    p_case_id: input.case_id,
    p_issue_date: input.issue_date,
    p_accounting_date: fechaDeRegistro,
    p_due_date: input.due_date,
    p_notes: input.notes,
    p_cufe: input.cufe,
    p_punto: input.punto,
    p_numero_documento: input.numero_documento,
    p_base_autorizada: input.base_autorizada,
    p_itbms_autorizado: input.itbms_autorizado,
    p_lineas: input.lines.map((l) => ({
      service_id: l.service_id,
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unit_price,
      tax_code_id: l.tax_code_id,
      tax_code: l.tax_code,
      tax_rate: l.tax_rate,
    })),
    p_asiento: armado.asiento.lines,
    p_created_by: userId,
  });
  if (error) {
    // 23505: otro registro con el mismo CUFE ganó la carrera (índice único).
    if ((error as { code?: string }).code === "23505") {
      const otra = await facturaConElCufe(db, tenantId, input.cufe);
      const m = otra ? mensajeDeCufeRepetido(otra) : error.message;
      throw new MutationError(m, 409, error, { cufe: m });
    }
    // Los mensajes del RPC ya vienen redactados para una persona.
    throw new MutationError(error.message || "No se pudo registrar la factura.", 422, error);
  }
  const r = data as { id: string; invoice_number: string; total: number | string; entry_number: number | string };
  return {
    id: r.id,
    invoice_number: r.invoice_number,
    total: Number(r.total),
    entry_number: Number(r.entry_number),
  };
}

export interface FacturaExternaFila {
  id: string;
  invoice_number: string;
  invoice_kind: string;
  issue_date: string;
  accounting_date: string;
  status: string;
  grand_total: number;
  balance_due: number;
  punto_facturacion: string | null;
  numero_documento: number | null;
  client_name: string;
}

/** Las facturas registradas por este camino, más nuevas primero. */
export async function listarFacturasExternas(db: DB, tenantId: string): Promise<FacturaExternaFila[]> {
  const { data, error } = await db
    .from("invoices")
    .select(
      "id, invoice_number, invoice_kind, issue_date, accounting_date, status, grand_total, balance_due, punto_facturacion, numero_documento, client:clients!invoices_client_id_fkey(name)"
    )
    .eq("tenant_id", tenantId)
    .eq("dgi_cufe_origen", "externo")
    .order("invoice_number", { ascending: false });
  if (error) throw new MutationError(pgErrorToMessage(error), 500, error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const cli = r.client as { name?: string } | { name?: string }[] | null;
    return {
      id: String(r.id),
      invoice_number: String(r.invoice_number),
      invoice_kind: String(r.invoice_kind),
      issue_date: String(r.issue_date),
      accounting_date: String(r.accounting_date),
      status: String(r.status),
      grand_total: Number(r.grand_total ?? 0),
      balance_due: Number(r.balance_due ?? 0),
      punto_facturacion: (r.punto_facturacion as string | null) ?? null,
      numero_documento: r.numero_documento === null || r.numero_documento === undefined ? null : Number(r.numero_documento),
      client_name: (Array.isArray(cli) ? cli[0]?.name : cli?.name) ?? "",
    };
  });
}
