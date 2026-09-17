/**
 * EL ASIENTO ESPEJO. Arma la reversión de un asiento ya posteado.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 ESTA ES LA ÚNICA IMPLEMENTACIÓN. LA USAN EL SERVIDOR Y LA PANTALLA.
 * ═════════════════════════════════════════════════════════════════════════════
 * `reverse-payment-dialog.tsx` dibuja la vista previa con ESTA función, y la
 * ruta `/api/finanzas/payments/[id]/reverse` postea lo que ESTA función
 * devuelve. Es la misma lección de `validarConsistenciaDeKind` (17/09/2026):
 * si la pantalla reimplementa el cálculo, algún día la vista previa miente
 * sobre lo que se va a postear — y un asiento no se borra.
 *
 * Por eso el módulo es PURO: sin I/O, sin React, sin Supabase, importable
 * desde un client component. Y por eso hay un test que lee el diálogo y
 * falla si deja de importar de acá o si intercambia débito y crédito por su
 * cuenta (`reversion-una-sola-implementacion.test.ts`).
 *
 * El RPC `reverse_payment` (migración `046`) no recalcula el espejo: lo
 * VERIFICA. Rechaza cualquier línea que no sea el reflejo exacto del original.
 * Es un cerrojo, no una segunda implementación.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * LA FECHA ES LA DE LA REVERSIÓN, NUNCA LA DEL ORIGINAL
 * ═════════════════════════════════════════════════════════════════════════════
 * Acta de la reunión con RM del 09/09/2026: "La reversión lleva SIEMPRE la
 * fecha en que se hace, nunca la del asiento que revierte." Postear con la
 * fecha original podría caer en un período cerrado y reescribiría un mes que
 * el contador ya reportó. La fecha entra por parámetro (`hoy`) para que el
 * servidor y la pantalla le pasen la misma; el RPC además la exige.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * QUÉ ES EL ESPEJO
 * ═════════════════════════════════════════════════════════════════════════════
 * Las mismas cuentas, en el mismo orden, con débito y crédito INTERCAMBIADOS.
 * No se netea, no se agrupa, no se redondea distinto: el original ya cuadró
 * en el RPC, y el reflejo exacto de algo que cuadra también cuadra.
 */

import type { AsientoInput, LineaAsiento } from "@/lib/finanzas/contabilidad/posting";

/** Una línea del asiento original, tal como la devuelve la base. */
export interface LineaOriginal {
  account_code: string;
  /** Solo para mostrar en la vista previa. No entra al asiento. */
  account_name?: string | null;
  debit: number;
  credit: number;
  description: string | null;
}

/** El asiento que se va a reversar. */
export interface AsientoAReversar {
  id: string;
  entry_number: number;
  /** ISO `YYYY-MM-DD`. */
  transaction_date: string;
  description: string;
  reference: string | null;
  lines: LineaOriginal[];
}

export interface DatosDeReversion {
  /** ISO `YYYY-MM-DD`. La fecha en que se hace, no la del original. */
  hoy: string;
  motivo: string;
  /** `source_id` del espejo: el documento que originó el asiento (el cobro). */
  source_id: string | null;
}

export type ResultadoReversion =
  | { ok: true; asiento: AsientoInput }
  | { ok: false; motivo: string; mensaje: string };

/** Mínimo del motivo. Espeja el CHECK `je_reversion_requires_ref` (Art. 5.7). */
export const MOTIVO_MIN = 3;
export const MOTIVO_MAX = 1000;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Arma el asiento espejo. Devuelve `{ ok: false }` con un mensaje mostrable si
 * el pedido no está bien formado; NO consulta nada (período cerrado, cobro ya
 * reversado: eso lo decide el RPC, que es quien tiene la base delante).
 */
export function construirAsientoDeReversion(
  original: AsientoAReversar,
  datos: DatosDeReversion
): ResultadoReversion {
  const motivo = datos.motivo.trim();
  if (motivo.length < MOTIVO_MIN) {
    return {
      ok: false,
      motivo: "motivo_corto",
      mensaje: `El motivo de la reversión debe tener al menos ${MOTIVO_MIN} caracteres.`,
    };
  }
  if (motivo.length > MOTIVO_MAX) {
    return {
      ok: false,
      motivo: "motivo_largo",
      mensaje: `El motivo de la reversión no puede superar los ${MOTIVO_MAX} caracteres.`,
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.hoy)) {
    return {
      ok: false,
      motivo: "fecha_invalida",
      mensaje: "La fecha de la reversión no tiene el formato esperado (AAAA-MM-DD).",
    };
  }
  if (datos.hoy < original.transaction_date) {
    return {
      ok: false,
      motivo: "fecha_anterior",
      mensaje:
        `La reversión (${datos.hoy}) no puede ser anterior al asiento que revierte ` +
        `(asiento ${original.entry_number}, ${original.transaction_date}).`,
    };
  }
  if (original.lines.length < 2) {
    return {
      ok: false,
      motivo: "sin_lineas",
      mensaje: `El asiento ${original.entry_number} no tiene líneas para reversar.`,
    };
  }

  const lines: LineaAsiento[] = original.lines.map((l) => ({
    account_code: l.account_code,
    // El espejo: lo que era débito pasa a crédito y viceversa.
    debit: round2(l.credit),
    credit: round2(l.debit),
    description: l.description ? `Reversión: ${l.description}` : "Reversión",
  }));

  return {
    ok: true,
    asiento: {
      transaction_date: datos.hoy,
      description: `Reversión del asiento ${original.entry_number} — ${original.description}`,
      source_type: "reversion",
      lines,
      source_id: datos.source_id,
      reverses_entry_id: original.id,
      reversal_reason: motivo,
      // La misma referencia que el original (en un cobro, el N° de factura):
      // el contador busca la reversión por el mismo papel que el asiento.
      reference: original.reference,
    },
  };
}
