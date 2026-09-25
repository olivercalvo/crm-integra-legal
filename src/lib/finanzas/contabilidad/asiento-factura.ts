/**
 * FACTURA → ASIENTO. Fila 2 del acta del 25/08.
 *
 *   DEBE  100004 Cuentas por Cobrar Clientes    (el grand_total)
 *   HABER la cuenta de ingreso de CADA servicio (por su subtotal)
 *   HABER 200003 ITBMS por Pagar                (la suma de los impuestos)
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * EL ITBMS VA A UNA SOLA CUENTA, Y ESO ESTÁ DECIDIDO
 * ═════════════════════════════════════════════════════════════════════════════
 * `200003 ITBMS por Pagar` recibe **las ventas al crédito y las compras al
 * débito**. No hay una cuenta de ITBMS de compras. Josuarth, 25/08, textual:
 *
 *   "Pero hay otra cuenta ITMS por pagar. No, es una sola. Es una sola cuenta.
 *    Que se llama ITMS por pagar. Y ahí va todo lo que vendo y lo que compro."
 *
 * Y el motivo, que es de operación y no de teoría:
 *
 *   "Hay sistemas contables que tienen una ITD para compra y una ITD para
 *    ingreso. Pero luego el contador todos los meses tiene que cerrar. Entonces
 *    nosotros preferimos tener un solo mayor."
 *
 * 🔴 Si alguien propone separar el ITBMS de compras del de ventas, eso no es una
 *    mejora: es deshacer una decisión del contador. El plan de trabajo afirmó lo
 *    contrario durante semanas y hubo que corregirlo cuatro veces.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * LA CUENTA DE INGRESO SALE DEL SERVICIO. NUNCA HAY UN DEFAULT.
 * ═════════════════════════════════════════════════════════════════════════════
 * Cada línea de la factura apunta a un servicio del catálogo, y ese servicio
 * dice a qué cuenta va su ingreso (`services_catalog.revenue_account`). Si el
 * servicio apunta a una cuenta que no existe o está inactiva en el plan vigente,
 * **este módulo rechaza el asiento nombrando el servicio y la cuenta**.
 *
 * ⚠️ NO hay cuenta genérica de respaldo, y es a propósito. Un default convierte
 * un error de configuración en un ingreso mal clasificado que nadie ve hasta que
 * el contador lee el estado de resultados — y el asiento es inmutable. Rechazar
 * es ruidoso y reversible; adivinar es silencioso y no.
 *
 * Hoy esto rechaza los siete servicios `HON-*`: apuntan a `4101`, que es del plan
 * anterior al de Josuarth y está INACTIVA. Los seis `REIM-*` apuntan a `130003`,
 * activa, y postean bien. Falta que el contador diga qué cuenta de ingreso ACTIVA
 * va en cada `HON-*`; hasta entonces el rechazo con nombre y apellido es el
 * comportamiento correcto, no una degradación.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUÉ EL REEMBOLSO NO ES UNA EXCEPCIÓN ACÁ
 * ═════════════════════════════════════════════════════════════════════════════
 * Los `REIM-*` acreditan `130003 Fondo Legales de Clientes`, que es un ACTIVO, no
 * un ingreso. Este módulo no los trata distinto: lee `revenue_account` igual que
 * para los honorarios. El acta pide exactamente eso —"nunca ingreso"— y la
 * migración `035` ya dejó el catálogo apuntando ahí.
 *
 * Es el cierre del par: al incurrir el gasto de trámite se DEBITA `130003`
 * (`asiento-gasto-tramite.ts`) y al facturar el reembolso se ACREDITA. La cuenta
 * vuelve a cero. Las dos puntas leen la misma cuenta desde lugares distintos, así
 * que no se derivan una de la otra: si divergen, el saldo de `130003` deja de
 * cerrar y eso se ve.
 *
 * Módulo PURO: sin I/O, sin React, sin Supabase.
 */

import type { AsientoInput, LineaAsiento } from "@/lib/finanzas/contabilidad/posting";

/** Cuenta control de clientes. El débito de toda factura va acá. */
export const CUENTA_POR_COBRAR = "100004";

/**
 * ITBMS, una sola cuenta para ventas y compras. Ver el encabezado.
 *
 * ⚠️ Coincide con el `200003` del resumen de ventas e ITBMS, pero NO se importa
 * de ahí ni se exporta hacia allá: son dos lecturas independientes de la misma
 * decisión del contador. Unificarlas en una constante compartida haría que un
 * cambio en el reporte moviera el asiento en silencio.
 */
export const CUENTA_ITBMS = "200003";

/** Una línea de factura, con el servicio ya resuelto contra el catálogo. */
export interface LineaFacturaParaAsiento {
  /** `invoice_lines.line_order`, para poder nombrar la línea en un rechazo. */
  line_order: number;
  description: string;
  /** Base imponible de la línea. */
  subtotal: number;
  /** ITBMS de la línea. Cero en los exentos. */
  tax_amount: number;
  /** `services_catalog.code`. `null` si la línea no tiene servicio. */
  service_code: string | null;
  /** `services_catalog.name`, para nombrar el servicio en palabras en un rechazo. */
  service_name?: string | null;
  /** `services_catalog.revenue_account`. `null` si no hay servicio. */
  revenue_account: string | null;
  /**
   * ¿La cuenta existe Y está activa en el plan vigente?
   *
   * Lo resuelve quien lee la base, no este módulo. Llega ya calculado para que
   * el módulo siga siendo puro y testeable sin Supabase.
   */
  cuenta_valida: boolean;
}

export interface FacturaParaAsiento {
  id: string;
  /** El correlativo YA generado. Ver `emitInvoice`. */
  invoice_number: string;
  issue_date: string;
  grand_total: number;
  client_name: string;
  lineas: LineaFacturaParaAsiento[];
}

export type ResultadoAsientoFactura =
  | { ok: true; asiento: AsientoInput }
  | { ok: false; motivo: string; mensaje: string };

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * La descripción del asiento (Art. 5.5: la NATURALEZA de la operación).
 *
 * Lleva número de factura y cliente porque es lo que el contador busca cuando
 * recorre el diario y quiere llegar al documento.
 */
export function descripcionDelAsientoDeFactura(f: FacturaParaAsiento): string {
  return `Factura ${f.invoice_number} — ${f.client_name}`;
}

/**
 * La clave de idempotencia.
 *
 * 🔑 Es la SEGUNDA llave, no la primera. La garantía real es el UNIQUE parcial
 * `(tenant_id, source_type, source_id)` de la migración `034`: con
 * `source_type='factura'` y `source_id = invoice.id`, el asiento duplicado ya es
 * imposible sin esto.
 *
 * Va igual porque es gratis y porque las dos salen del MISMO id, así que no
 * pueden discrepar. Si alguna vez hay que quedarse con una sola, la que se queda
 * es `source_id`.
 */
export function claveIdempotenteDeFactura(invoiceId: string): string {
  return `factura:${invoiceId}`;
}

/**
 * Arma el asiento de una factura que se está emitiendo.
 *
 * Devuelve un resultado discriminado en vez de lanzar: quien llama necesita
 * distinguir "no se puede armar por configuración" (un 422 con mensaje para el
 * usuario) de un error de infraestructura.
 *
 * ⚠️ Lo que este módulo NO valida, a propósito, porque lo valida el RPC y
 * duplicarlo crearía dos verdades: que el período esté abierto, que las cuentas
 * existan en la base, y el cuadre contra la base. Acá sí se verifica el cuadre
 * ARITMÉTICO, que es otra cosa: es una red contra un error de redondeo de este
 * mismo archivo, no una revalidación de la base.
 */
export function construirAsientoDeFactura(
  f: FacturaParaAsiento
): ResultadoAsientoFactura {
  if (f.lineas.length === 0) {
    return {
      ok: false,
      motivo: "sin_lineas",
      mensaje: `La factura ${f.invoice_number} no tiene líneas.`,
    };
  }

  // ---- 1) Líneas sin servicio ---------------------------------------------
  // `invoice_lines.service_id` es NULLABLE. Una línea escrita a mano no dice a
  // qué cuenta de ingreso va, y no hay forma de deducirlo.
  const sinServicio = f.lineas.filter((l) => !l.service_code || !l.revenue_account);
  if (sinServicio.length > 0) {
    const detalle = sinServicio
      .map((l) => `línea ${l.line_order} ("${l.description}")`)
      .join(", ");
    return {
      ok: false,
      motivo: "sin_servicio",
      mensaje:
        `No se puede registrar la factura ${f.invoice_number} en el libro contable: ` +
        `${detalle} no tiene un servicio del catálogo que diga a qué cuenta de ingreso va. ` +
        `Asigne un servicio a la línea o pida que se configure su cuenta.`,
    };
  }

  // ---- 2) Servicios que apuntan a una cuenta inválida ----------------------
  // 🔴 El mensaje NOMBRA el servicio y la cuenta. El RPC también rechaza esto
  //    (paso 4: `AND c.active` dentro del EXISTS), pero su mensaje solo dice el
  //    CÓDIGO —"Cuenta(s) inexistentes o inactivas en el plan: 4101"— y con eso
  //    nadie sabe qué tocar. Este guard existe por el MENSAJE, no por el permiso:
  //    el permiso ya lo tiene la base. Borrarlo no abre un agujero contable,
  //    pero deja al usuario sin saber qué servicio configurar.
  const invalidas = f.lineas.filter((l) => !l.cuenta_valida);
  if (invalidas.length > 0) {
    const pares = Array.from(
      new Map(invalidas.map((l) => [`${l.service_code}|${l.revenue_account}`, l])).values()
    );
    // En lenguaje simple (25/09/2026): el servicio EN PALABRAS, su código y la
    // cuenta. "HON-FAM → cuenta 4101" no le dice nada a quien factura.
    const nombrar = (l: LineaFacturaParaAsiento) =>
      l.service_name
        ? `«${l.service_name}» (${l.service_code})`
        : `${l.service_code}`;
    const cual = f.invoice_number ? `la factura ${f.invoice_number}` : "esta factura";
    const mensaje =
      pares.length === 1
        ? `No se puede emitir ${cual}: el servicio ${nombrar(pares[0])} usa la cuenta de ` +
          `ingreso ${pares[0].revenue_account}, que no existe o está desactivada en el plan de ` +
          `cuentas. Hay que corregir la cuenta de ese servicio en el catálogo de servicios ` +
          `antes de emitir.`
        : `No se puede emitir ${cual}: estos servicios usan cuentas de ingreso que no existen ` +
          `o están desactivadas en el plan de cuentas: ` +
          pares.map((l) => `${nombrar(l)}, cuenta ${l.revenue_account}`).join("; ") +
          `. Hay que corregir la cuenta de cada servicio en el catálogo antes de emitir.`;
    return { ok: false, motivo: "cuenta_invalida", mensaje };
  }

  // ---- 3) Agrupar los créditos de ingreso POR CUENTA -----------------------
  // Dos servicios distintos pueden apuntar a la misma cuenta. Una línea por
  // cuenta y no una por línea de factura: el mayor de esa cuenta se lee mejor y
  // el asiento no crece con el detalle comercial de la factura.
  const porCuenta = new Map<string, number>();
  for (const l of f.lineas) {
    const cuenta = l.revenue_account as string;
    porCuenta.set(cuenta, round2((porCuenta.get(cuenta) ?? 0) + l.subtotal));
  }

  const itbms = round2(f.lineas.reduce((s, l) => s + l.tax_amount, 0));
  const debe = round2(f.grand_total);

  const lines: LineaAsiento[] = [
    {
      account_code: CUENTA_POR_COBRAR,
      debit: debe,
      credit: 0,
      description: `Factura ${f.invoice_number}`,
    },
  ];
  for (const [cuenta, monto] of Array.from(porCuenta.entries()).sort()) {
    if (monto === 0) continue;
    lines.push({ account_code: cuenta, debit: 0, credit: monto, description: null });
  }
  if (itbms > 0) {
    lines.push({
      account_code: CUENTA_ITBMS,
      debit: 0,
      credit: itbms,
      description: "ITBMS facturado",
    });
  }

  // ---- 4) Red contra un error de redondeo DE ESTE ARCHIVO ------------------
  // El RPC vuelve a verificar el cuadre y es la autoridad. Se chequea acá igual
  // porque si no cuadra el problema está en las líneas de la factura
  // (grand_total ≠ Σ subtotales + Σ impuestos) y el mensaje del RPC no lo diría.
  const sumaCreditos = round2(lines.reduce((s, l) => s + l.credit, 0));
  if (sumaCreditos !== debe) {
    return {
      ok: false,
      motivo: "no_cuadra",
      mensaje:
        `La factura ${f.invoice_number} no cuadra: el total es ${debe.toFixed(2)} ` +
        `pero las líneas suman ${sumaCreditos.toFixed(2)} ` +
        `(diferencia ${round2(debe - sumaCreditos).toFixed(2)}). ` +
        `No se registró nada en el libro contable.`,
    };
  }

  return {
    ok: true,
    asiento: {
      transaction_date: f.issue_date,
      description: descripcionDelAsientoDeFactura(f),
      source_type: "factura",
      lines,
      source_id: f.id,
      reference: f.invoice_number,
      idempotency_key: claveIdempotenteDeFactura(f.id),
    },
  };
}
