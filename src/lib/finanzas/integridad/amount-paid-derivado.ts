/**
 * VERIFICACIÓN DE INTEGRIDAD — `invoices.amount_paid` contra sus pagos.
 *
 * `amount_paid` es un número DERIVADO: lo mantiene el trigger T7a como
 * `SUM(payment_applications.amount_applied)` de la factura. Desde la migración
 * `sql/pending/032_amount_paid_derivado.sql` el guard T4b impide escribirlo a
 * mano, así que en teoría no puede desalinearse.
 *
 * "En teoría" es la razón por la que existe este archivo. El guard es nuevo, la
 * válvula de escape de SOP-017 existe a propósito, y en producción puede haber
 * desfases anteriores al guard — que este NO corrige, solo impide nuevos.
 *
 * Se usa en tres lugares, por razones distintas:
 *   · al final de `seed:staging` y de `seed:asientos`, para que una siembra que
 *     deje datos incoherentes falle en el momento y no seis días después;
 *   · en la suite de tests, para que la lógica rompa aunque nadie siembre.
 *
 * NO va dentro de `verify_accounting_chain()`: esa función verifica el LEDGER, y
 * esto es facturación. Mezclarlas haría que un problema de facturación se
 * reporte como cadena de asientos rota, que es el diagnóstico equivocado y el
 * más caro de perseguir.
 */

/** Tolerancia de comparación. Las dos columnas son NUMERIC(12,2). */
const TOLERANCIA = 0.005;

export interface FacturaParaVerificar {
  id: string;
  invoice_number: string;
  status: string;
  amount_paid: number | string;
}

export interface AplicacionParaVerificar {
  invoice_id: string;
  amount_applied: number | string;
}

export interface DesfaseAmountPaid {
  invoice_number: string;
  status: string;
  amount_paid: number;
  suma_aplicada: number;
  diferencia: number;
}

function num(v: number | string): number {
  return typeof v === "number" ? v : Number(v);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Núcleo puro: dadas las facturas y las aplicaciones de pago, devuelve las
 * facturas cuyo `amount_paid` no coincide con lo que sus pagos justifican.
 *
 * Una factura sin ninguna aplicación tiene que tener `amount_paid = 0`. Ese es
 * exactamente el caso que se coló el 28/08 (FAC-REI-000001, `amount_paid` 150
 * con cero pagos), así que es el que más importa que quede cubierto.
 */
export function desfasesDeAmountPaid(
  facturas: FacturaParaVerificar[],
  aplicaciones: AplicacionParaVerificar[]
): DesfaseAmountPaid[] {
  const aplicadoPorFactura = new Map<string, number>();
  for (const a of aplicaciones) {
    aplicadoPorFactura.set(a.invoice_id, (aplicadoPorFactura.get(a.invoice_id) ?? 0) + num(a.amount_applied));
  }

  const desfases: DesfaseAmountPaid[] = [];
  for (const f of facturas) {
    const declarado = num(f.amount_paid);
    const aplicado = round2(aplicadoPorFactura.get(f.id) ?? 0);
    const diferencia = round2(declarado - aplicado);
    if (Math.abs(diferencia) > TOLERANCIA) {
      desfases.push({
        invoice_number: f.invoice_number,
        status: f.status,
        amount_paid: round2(declarado),
        suma_aplicada: aplicado,
        diferencia,
      });
    }
  }
  return desfases.sort((a, b) => a.invoice_number.localeCompare(b.invoice_number));
}

/** Mensaje de error accionable. Se usa igual desde los seeds y desde el test. */
export function formatearDesfases(desfases: DesfaseAmountPaid[]): string {
  const filas = desfases
    .map(
      (d) =>
        `   · ${d.invoice_number.padEnd(16)} status ${d.status.padEnd(22)}` +
        ` amount_paid ${d.amount_paid.toFixed(2)} · aplicado ${d.suma_aplicada.toFixed(2)}` +
        ` · diferencia ${d.diferencia > 0 ? "+" : ""}${d.diferencia.toFixed(2)}`
    )
    .join("\n");

  return (
    `${desfases.length} factura(s) con \`amount_paid\` desfasado de sus pagos:\n${filas}\n\n` +
    `   QUÉ SIGNIFICA\n` +
    `     \`amount_paid\` se deriva de \`payment_applications\` (trigger T7a). Una\n` +
    `     diferencia POSITIVA es una factura que se declara cobrada sin que exista\n` +
    `     el pago; una NEGATIVA es un pago aplicado que no se reflejó.\n\n` +
    `   QUÉ HACER\n` +
    `     Si falta el pago, agregarlo a \`SEED_PAYMENTS\` en\n` +
    `     \`scripts/seed-data/staging-fixtures.ts\` — NO escribir \`amount_paid\`, que\n` +
    `     desde la migración 032 el guard T4b lo rechaza.\n` +
    `     Si el desfase es anterior al guard (puede pasar en producción), es un\n` +
    `     problema contable real: se resuelve con el contador, no con el seed.`
  );
}
