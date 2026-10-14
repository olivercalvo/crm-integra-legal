/**
 * CORREGIR UNA COMPRA CONTABILIZADA (103) · lógica PURA: por qué no se puede
 * corregir (lo que la pantalla muestra ANTES de editar) y qué cambió en cada
 * versión del historial. Sin I/O.
 *
 * Los textos de bloqueo son los mismos que devuelve `corregir_compra` en la
 * base: la pantalla los dice antes, la base los vuelve a exigir.
 */

export interface DatosDelBloqueo {
  /** Números de los pagos registrados (o «saldo heredado»). */
  pagos: string[];
  /** Números de las notas de crédito del proveedor emitidas sobre la compra. */
  notasDeCredito: string[];
  /** MM/AAAA del asiento vigente si su mes está cerrado; null si está abierto. */
  mesCerrado: string | null;
}

/** Por qué no se corrige, o null si se puede. El orden es el de la base. */
export function motivoParaNoCorregir(d: DatosDelBloqueo): string | null {
  if (d.pagos.length > 0) {
    return (
      `Esta compra tiene ${d.pagos.length} pago(s) registrado(s) (${d.pagos.join(", ")}). ` +
      "Primero reversa los pagos con asiento o elimina los que no lo tienen; después se corrige la compra."
    );
  }
  if (d.notasDeCredito.length > 0) {
    return (
      `Esta compra tiene nota(s) de crédito del proveedor (${d.notasDeCredito.join(", ")}). ` +
      "Primero se reversan; después se corrige la compra."
    );
  }
  if (d.mesCerrado) {
    return (
      `El mes del asiento de la compra (${d.mesCerrado}) está cerrado: la compra no se corrige. ` +
      "El ajuste va con un asiento de diario en un mes abierto, o el contador reabre el mes en Períodos contables."
    );
  }
  return null;
}

/** La foto de la compra que guarda `compra_correcciones` (antes y después). */
export interface FotoDeCompra {
  expense_date?: string | null;
  accounting_date?: string | null;
  due_date?: string | null;
  supplier_id?: string | null;
  supplier_invoice_number?: string | null;
  description?: string | null;
  subtotal?: number | string | null;
  tax_amount?: number | string | null;
  total?: number | string | null;
  lineas?: {
    description?: string | null;
    chart_account_code?: string | null;
    amount?: number | string | null;
    tax_code_id?: string | null;
    tax_amount?: number | string | null;
  }[];
}

const fecha = (v: string | null | undefined) =>
  v ? `${String(v).slice(8, 10)}/${String(v).slice(5, 7)}/${String(v).slice(0, 4)}` : "(vacía)";
const monto = (v: number | string | null | undefined) =>
  Number(v ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const texto = (v: string | null | undefined) => (v && String(v).trim() ? String(v).trim() : "(vacío)");

/**
 * Qué cambió entre dos fotos, en frases cortas para el historial. Las líneas
 * se comparan por posición: cuenta, base e impuesto.
 */
export function cambiosDeLaCorreccion(
  antes: FotoDeCompra,
  despues: FotoDeCompra,
  nombreDelProveedor: (id: string | null | undefined) => string = (id) => (id ? "otro proveedor" : "(sin proveedor)")
): string[] {
  const out: string[] = [];
  const f = (k: "expense_date" | "accounting_date" | "due_date", etiqueta: string) => {
    if (String(antes[k] ?? "").slice(0, 10) !== String(despues[k] ?? "").slice(0, 10)) {
      out.push(`${etiqueta}: ${fecha(antes[k])} → ${fecha(despues[k])}`);
    }
  };
  f("accounting_date", "Fecha de registro");
  f("expense_date", "Fecha del documento");
  f("due_date", "Vencimiento");
  if ((antes.supplier_id ?? null) !== (despues.supplier_id ?? null)) {
    out.push(`Proveedor: ${nombreDelProveedor(antes.supplier_id)} → ${nombreDelProveedor(despues.supplier_id)}`);
  }
  if (texto(antes.supplier_invoice_number) !== texto(despues.supplier_invoice_number)) {
    out.push(`N.º factura del proveedor: ${texto(antes.supplier_invoice_number)} → ${texto(despues.supplier_invoice_number)}`);
  }
  if (texto(antes.description) !== texto(despues.description)) {
    out.push(`Descripción: ${texto(antes.description)} → ${texto(despues.description)}`);
  }
  const la = antes.lineas ?? [];
  const ld = despues.lineas ?? [];
  const n = Math.max(la.length, ld.length);
  for (let i = 0; i < n; i++) {
    const a = la[i];
    const d = ld[i];
    if (!a && d) { out.push(`Línea ${i + 1} agregada: ${d.chart_account_code ?? ""} por ${monto(d.amount)}`); continue; }
    if (a && !d) { out.push(`Línea ${i + 1} quitada: ${a.chart_account_code ?? ""} por ${monto(a.amount)}`); continue; }
    if (!a || !d) continue;
    if ((a.chart_account_code ?? "") !== (d.chart_account_code ?? "")) {
      out.push(`Línea ${i + 1}, cuenta: ${a.chart_account_code ?? "(sin cuenta)"} → ${d.chart_account_code ?? "(sin cuenta)"}`);
    }
    if (monto(a.amount) !== monto(d.amount)) out.push(`Línea ${i + 1}, base: ${monto(a.amount)} → ${monto(d.amount)}`);
    if ((a.tax_code_id ?? "") !== (d.tax_code_id ?? "") || monto(a.tax_amount) !== monto(d.tax_amount)) {
      out.push(`Línea ${i + 1}, ITBMS: ${monto(a.tax_amount)} → ${monto(d.tax_amount)}`);
    }
    if (texto(a.description) !== texto(d.description)) out.push(`Línea ${i + 1}, descripción cambiada`);
  }
  if (monto(antes.total) !== monto(despues.total)) out.push(`Total: ${monto(antes.total)} → ${monto(despues.total)}`);
  return out;
}
