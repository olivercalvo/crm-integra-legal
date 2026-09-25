/**
 * EL ASIENTO PROPIO DE UNA NOTA DE CRÉDITO — armado puro (Bloque 5, D5).
 *
 * Una NC posterior o parcial NO es una reversión: la factura sigue existiendo
 * y hubo un hecho nuevo (descuento, devolución, error de monto que se corrige
 * con fecha de hoy). Por eso lleva asiento PROPIO, `source_type =
 * 'nota_credito'` con `source_id = la NC`, y no un espejo con
 * `reverses_entry_id`. El Mayor lo muestra como "Nota de crédito NC-000001"
 * con su drill-down; el Diario lo lista como documento.
 *
 * Es la factura al revés, POR LÍNEAS:
 *
 *   DEBE  la cuenta de ingreso de cada línea (o 130003 en los REIM-*),
 *         agrupada por cuenta, por lo acreditado
 *   DEBE  200003 ITBMS por Pagar, por el ITBMS de las líneas acreditadas
 *   HABER 100004 Cuentas por Cobrar, por el total de la NC
 *
 * Se arma con `construirAsientoDeFactura` sobre la NC (misma agrupación por
 * cuenta, misma validación de cuentas y de cuadre) y se invierten débitos y
 * créditos. No es una reimplementación del espejo de `reversion.ts`: aquello
 * espeja un ASIENTO existente; esto arma un documento nuevo. La NC parcial da
 * el ITBMS proporcional exacto porque cada línea trae su tasa.
 *
 * (La anulación dentro del mes NO usa esto: revierte el asiento original con
 * `construirAsientoDeReversion` y la NC total que la acompaña no se postea
 * aparte, porque sería contabilizar dos veces lo mismo. D5.)
 *
 * Módulo PURO: sin I/O.
 */

import type { AsientoInput, LineaAsiento } from "@/lib/finanzas/contabilidad/posting";
import {
  construirAsientoDeFactura,
  type FacturaParaAsiento,
  type ResultadoAsientoFactura,
} from "@/lib/finanzas/contabilidad/asiento-factura";

export const SOURCE_TYPE_NOTA_CREDITO = "nota_credito" as const;

export interface NotaDeCreditoParaAsiento {
  id: string;
  credit_note_number: string;
  /** La fecha de la NC: HOY, nunca la de la factura. */
  issue_date: string;
  grand_total: number;
  invoice_number: string;
  client_name: string;
  /** Las líneas de la NC con la cuenta de ingreso de su servicio, como en la factura. */
  lineas: FacturaParaAsiento["lineas"];
}

export function claveIdempotenteDeNotaDeCredito(ncId: string): string {
  return `nota-credito:${ncId}`;
}

export function construirAsientoDeNotaDeCredito(nc: NotaDeCreditoParaAsiento): ResultadoAsientoFactura {
  // La NC como si fuera una factura: misma agrupación por cuenta de ingreso,
  // mismas validaciones (líneas sin servicio, cuentas inactivas, cuadre).
  const comoFactura = construirAsientoDeFactura({
    id: nc.id,
    invoice_number: nc.credit_note_number,
    issue_date: nc.issue_date,
    grand_total: nc.grand_total,
    client_name: nc.client_name,
    lineas: nc.lineas,
  });
  if (!comoFactura.ok) {
    // Los mensajes de la factura nombran "la factura NC-…": se dicen para la NC.
    return {
      ...comoFactura,
      mensaje: comoFactura.mensaje
        .replace(/registrar la factura/g, "registrar la nota de crédito")
        // Desde el 25/09 el rechazo por cuenta inactiva dice "emitir la factura".
        .replace(/emitir (la factura|esta factura)/g, "registrar la nota de crédito"),
    };
  }

  // Al revés: lo que la factura acreditó (ingreso, ITBMS) la NC lo debita;
  // lo que debitó (100004) la NC lo acredita.
  const lines: LineaAsiento[] = comoFactura.asiento.lines.map((l) => ({
    account_code: l.account_code,
    debit: l.credit,
    credit: l.debit,
    description:
      l.description === `Factura ${nc.credit_note_number}`
        ? `Nota de crédito ${nc.credit_note_number} — factura ${nc.invoice_number}`
        : l.description === "ITBMS facturado"
          ? "ITBMS acreditado"
          : l.description,
  }));

  const asiento: AsientoInput = {
    ...comoFactura.asiento,
    description: `Nota de crédito ${nc.credit_note_number} — Factura ${nc.invoice_number} — ${nc.client_name}`,
    source_type: SOURCE_TYPE_NOTA_CREDITO,
    source_id: nc.id,
    reference: nc.credit_note_number,
    idempotency_key: claveIdempotenteDeNotaDeCredito(nc.id),
    lines,
  };
  return { ok: true, asiento };
}
