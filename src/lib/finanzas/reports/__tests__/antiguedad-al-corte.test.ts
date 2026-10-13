/**
 * 🔒 ANTIGÜEDAD CON FECHA DE CORTE (requerimiento 41, 08/10/2026).
 *
 * El reporte «Al dd/mm/aaaa» toma sólo lo registrado hasta ese día y cuenta los
 * días de atraso contra esa fecha. Lo que exige el pedido, con nombre propio:
 *   - un cobro POSTERIOR al corte no rebaja la factura;
 *   - una factura POSTERIOR al corte no aparece.
 *
 *   npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  diasAlCorte,
  fechaDeAplicacion,
  fechaDeCorte,
  saldoAlCorte,
} from "@/lib/finanzas/reports/antiguedad-al-corte";
import { loadAntiguedad } from "@/lib/finanzas/reports/antiguedad-source";
import { buildAntiguedad } from "@/lib/finanzas/reports/antiguedad";
import { hojaDeAntiguedad } from "@/lib/finanzas/reports/mayor-export";

const leer = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

// ---------------------------------------------------------------------------
// Las reglas, puras
// ---------------------------------------------------------------------------

test("saldo al corte: el documento existe desde su fecha y cada baja resta desde la suya", () => {
  const h = { desde: "2026-03-10", total: 1000, bajas: [{ fecha: "2026-04-05", monto: 400 }] };
  assert.equal(saldoAlCorte(h, "2026-03-09"), null, "antes de su fecha no existe");
  assert.equal(saldoAlCorte(h, "2026-03-31"), 1000, "el cobro de abril todavía no rebaja");
  assert.equal(saldoAlCorte(h, "2026-04-05"), 600, "el día del cobro, ya rebaja");
});

test("lo reversado resta hasta el día de su reversión; lo anulado deja de existir ese día", () => {
  const cobroReversado = { desde: "2026-03-10", total: 1000, bajas: [{ fecha: "2026-04-05", monto: 1000, hasta: "2026-05-02" }] };
  assert.equal(saldoAlCorte(cobroReversado, "2026-04-30"), 0, "al 30/04 estaba cobrada");
  assert.equal(saldoAlCorte(cobroReversado, "2026-05-02"), 1000, "desde la reversión vuelve a deber");
  const anulada = { desde: "2026-03-10", total: 500, bajas: [], finEn: "2026-03-20" };
  assert.equal(saldoAlCorte(anulada, "2026-03-15"), 500, "antes de anularla era una cuenta por cobrar");
  assert.equal(saldoAlCorte(anulada, "2026-03-20"), null);
});

test("días de atraso contra el corte, sin depender de la zona del servidor", () => {
  assert.equal(diasAlCorte("2026-03-31", "2026-04-30"), 30);
  assert.equal(diasAlCorte("2026-05-15", "2026-04-30"), -15, "todavía no vence");
  assert.equal(diasAlCorte("2026-03-08", "2026-03-08"), 0);
});

test("la fecha de corte de la URL: sólo AAAA-MM-DD válida", () => {
  assert.equal(fechaDeCorte("2026-04-30"), "2026-04-30");
  for (const v of ["2026-02-30", "30/04/2026", "", undefined, "2026-4-3"]) assert.equal(fechaDeCorte(v), null, String(v));
});

test("una aplicación hecha DESPUÉS del cobro (saldo a favor) lleva el día en que se aplicó", () => {
  const dia = (d: Date) => d.toISOString().slice(0, 10);
  assert.equal(fechaDeAplicacion("2026-04-05", "2026-04-07T15:00:00Z", "2026-04-07T15:00:03Z", dia), "2026-04-05", "grabada con el cobro");
  assert.equal(fechaDeAplicacion("2026-04-05", "2026-04-07T15:00:00Z", "2026-05-10T15:00:00Z", dia), "2026-05-10");
});

// ---------------------------------------------------------------------------
// La fuente, con una base falsa (devuelve las tablas enteras; la lógica filtra)
// ---------------------------------------------------------------------------

function fakeDb(datos: Record<string, unknown[]>) {
  const tabla = (nombre: string) => {
    const q: Record<string, unknown> = {};
    const self = () => q;
    for (const op of ["select", "eq", "neq", "in", "not", "order", "is", "or", "lt", "lte", "gt", "limit"]) q[op] = self;
    q.maybeSingle = async () => ({ data: (datos[nombre] ?? [])[0] ?? null, error: null });
    q.then = (r: (v: unknown) => unknown) => r({ data: datos[nombre] ?? [], error: null });
    return q;
  };
  return { from: tabla };
}

const CLIENTE = { id: "cli-1", name: "FERRETERÍA VALLARINO, S.A." };
const factura = (id: string, numero: string, fecha: string, vence: string, total: number, status = "emitida") => ({
  id, invoice_number: numero, issue_date: fecha, accounting_date: fecha, due_date: vence, grand_total: total,
  status, cancelled_at: null, client_id: CLIENTE.id, clients: CLIENTE,
});

function baseCobrar() {
  return {
    finanzas_parametros: [{ fecha_inicio_contable: "2026-01-01" }],
    chart_of_accounts: [{ id: "cta-100004", code: "100004", name: "Cuentas por Cobrar Clientes", saldo_inicial: 0 }],
    invoices: [
      factura("f1", "FAC-HON-000100", "2026-03-10", "2026-04-09", 1000, "pagada"),
      factura("f2", "FAC-HON-000200", "2026-05-03", "2026-06-02", 300),
    ],
    // El cobro de f1 es del 05/05, después de un corte al 30/04.
    payments: [{ id: "p1", payment_number: "CO-000001", payment_date: "2026-05-05", amount: 1000, status: "registrado", created_at: "2026-05-05T15:00:00Z", updated_at: null, client_id: CLIENTE.id, clients: CLIENTE }],
    payment_applications: [{ payment_id: "p1", invoice_id: "f1", amount_applied: 1000, applied_at: "2026-05-05T15:00:01Z", created_at: "2026-05-05T15:00:01Z", payments: { payment_date: "2026-05-05", created_at: "2026-05-05T15:00:00Z" } }],
    journal_entries: [],
    journal_entry_lines: [],
  };
}

test("🔒 un cobro posterior al corte NO rebaja la factura", async () => {
  const { documentos } = await loadAntiguedad(fakeDb(baseCobrar()) as never, "t1", "cobrar", "2026-04-30");
  const f1 = documentos.find((d) => d.id === "f1");
  assert.ok(f1, "al 30/04 la factura pagada el 05/05 estaba pendiente");
  assert.equal(f1!.saldo, 1000);
  assert.equal(f1!.diasVencido, 21, "del 09/04 al 30/04, contado contra el corte");
  // Al día del cobro ya no está.
  const despues = await loadAntiguedad(fakeDb(baseCobrar()) as never, "t1", "cobrar", "2026-05-05");
  assert.equal(despues.documentos.find((d) => d.id === "f1"), undefined);
});

test("🔒 una factura posterior al corte NO aparece", async () => {
  const { documentos } = await loadAntiguedad(fakeDb(baseCobrar()) as never, "t1", "cobrar", "2026-04-30");
  assert.equal(documentos.find((d) => d.id === "f2"), undefined, "FAC-HON-000200 es del 03/05");
  const despues = await loadAntiguedad(fakeDb(baseCobrar()) as never, "t1", "cobrar", "2026-05-10");
  assert.equal(despues.documentos.find((d) => d.id === "f2")?.saldo, 300);
});

test("un cobro reversado DESPUÉS del corte sí rebajaba al corte; una factura anulada después, existía", async () => {
  const datos = {
    ...baseCobrar(),
    invoices: [
      factura("f1", "FAC-HON-000100", "2026-03-10", "2026-04-09", 1000),
      { ...factura("f3", "FAC-HON-000300", "2026-03-12", "2026-04-11", 200, "anulada"), cancelled_at: "2026-05-20T15:00:00Z" },
    ],
    payments: [{ id: "p1", payment_number: "CO-000001", payment_date: "2026-04-05", amount: 1000, status: "anulado", created_at: "2026-04-05T15:00:00Z", updated_at: "2026-05-02T15:00:00Z", client_id: CLIENTE.id, clients: CLIENTE }],
    payment_applications: [],
    payment_reversals: [{ payment_id: "p1", invoice_id: "f1", amount_applied: 1000, reversed_at: "2026-05-02T15:00:00Z", payments: { payment_date: "2026-04-05" } }],
    journal_entries: [
      { id: "je-p1", source_id: "p1", source_type: "pago" },
      { id: "je-rev", reverses_entry_id: "je-p1", transaction_date: "2026-05-02" },
    ],
  };
  const al30 = await loadAntiguedad(fakeDb(datos) as never, "t1", "cobrar", "2026-04-30");
  assert.equal(al30.documentos.find((d) => d.id === "f1"), undefined, "al 30/04 estaba cobrada");
  assert.equal(al30.documentos.find((d) => d.id === "f3")?.saldo, 200, "al 30/04 la anulada del 20/05 se debía");
  const al31 = await loadAntiguedad(fakeDb(datos) as never, "t1", "cobrar", "2026-05-31");
  assert.equal(al31.documentos.find((d) => d.id === "f1")?.saldo, 1000, "reversado el cobro, vuelve a deber");
  assert.equal(al31.documentos.find((d) => d.id === "f3"), undefined);
});

test("por pagar: un pago posterior al corte no rebaja la compra", async () => {
  const datos = {
    finanzas_parametros: [{ fecha_inicio_contable: "2026-01-01" }],
    chart_of_accounts: [{ id: "cta-200001", code: "200001", name: "Cuentas por pagar", saldo_inicial: 0 }],
    business_expenses: [{ id: "c1", supplier_id: "prov-1", supplier_name: null, description: "Alquiler", expense_date: "2026-03-01", accounting_date: "2026-03-01", due_date: "2026-03-31", total: 800 }],
    supplier_payments: [{ id: "sp1", business_expense_id: "c1", expense_id: null, kind: "payment", amount: 800, payment_date: "2026-05-15", status: "registrado", updated_at: null }],
    suppliers: [{ id: "prov-1", legal_name: "INMOBILIARIA", trade_name: null }],
    journal_entries: [],
    journal_entry_lines: [],
  };
  const al30 = await loadAntiguedad(fakeDb(datos) as never, "t1", "pagar", "2026-04-30");
  assert.equal(al30.documentos.find((d) => d.id === "c1")?.saldo, 800);
  assert.equal(al30.documentos.find((d) => d.id === "c1")?.diasVencido, 30);
  const al31 = await loadAntiguedad(fakeDb(datos) as never, "t1", "pagar", "2026-05-31");
  assert.equal(al31.documentos.find((d) => d.id === "c1"), undefined);
});

// ---------------------------------------------------------------------------
// Pantalla, Excel y cuenta control usan la MISMA fecha
// ---------------------------------------------------------------------------

test("el Excel lleva la fecha de corte en el encabezado", () => {
  const r = buildAntiguedad([], {
    saldoCuentaControl: 0, saldoApertura: 0, cuentaCodigo: "100004", cuentaNombre: "CxC",
    sinAsiento: { documentos: { cantidad: 0, monto: 0 }, cobros: { cantidad: 0, monto: 0 } },
  });
  const hoja = hojaDeAntiguedad(r, "cobrar", new Map(), { bufete: "Integra", generadoEl: "08/10/2026", alCorte: "2026-04-30" });
  assert.deepEqual(hoja.encabezado?.find((f) => f[0] === "Al"), ["Al", "30/04/2026"]);
});

test("pantalla y Excel pasan el corte al MISMO loader; la cuenta control se corta por fecha de registro", () => {
  const pagina = leer("src/app/finanzas/reportes/aging/page.tsx");
  assert.match(pagina, /name="al"/);
  // El aviso azul ya no dice «no tiene corte por fechas» en esta pantalla.
  assert.match(pagina, /<OpeningBalancesNotice conFechaDeCorte \/>/);
  assert.match(pagina, /loadAntiguedad\(ctx\.db, ctx\.tenantId, tipo, corte\)/);
  assert.match(pagina, /aging\/export\?tipo=\$\{tipo\}&al=\$\{corte\}/);
  const exp = leer("src/app/api/finanzas/reportes/aging/export/route.ts");
  assert.match(exp, /loadAntiguedad\(ctx\.db, ctx\.tenantId, tipo, corte\)/);
  assert.match(exp, /alCorte: corte/);
  const fuente = leer("src/lib/finanzas/reports/antiguedad-source.ts");
  assert.match(fuente, /\.lte\("journal_entries\.transaction_date", corte\)/);
});
