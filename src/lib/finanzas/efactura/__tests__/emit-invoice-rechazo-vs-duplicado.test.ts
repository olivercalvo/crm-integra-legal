/**
 * Test END-TO-END de la clasificación rechazo vs duplicado: corre
 * `emitInvoiceToEfactura` COMPLETO (fake de Supabase + stub de fetch) y mira el
 * `EmitToEfacturaResult` que realmente viaja al diálogo, no solo el helper puro.
 *
 * Caso real (2026-08): con un RUC inválido el diálogo mostraba a la vez
 * "…el documento ya existe. Posiblemente ya fue autorizado" y los códigos
 * 1601/1602 de RUC. La licenciada creyó que había que ANULAR.
 *
 * Ejecución:
 *   npx tsx --test src/lib/finanzas/efactura/__tests__/emit-invoice-rechazo-vs-duplicado.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

Object.assign(process.env, {
  EFACTURA_EMISOR_RUC: "1234567",
  EFACTURA_EMISOR_DV: "12",
  EFACTURA_EMISOR_TIPO_CONTRIBUYENTE: "2",
  EFACTURA_EMISOR_RAZON_SOCIAL: "Integra Legal, S.A.",
  EFACTURA_EMISOR_SUCURSAL: "0000",
  EFACTURA_EMISOR_DIRECCION: "Calle 50, Edif. Ejemplo",
  EFACTURA_EMISOR_UBICACION_CODIGO: "8-8-7",
  EFACTURA_EMISOR_CORREGIMIENTO: "Bella Vista",
  EFACTURA_EMISOR_DISTRITO: "Panamá",
  EFACTURA_EMISOR_PROVINCIA: "Panamá",
  EFACTURA_EMISOR_PUNTO_FACTURACION: "051",
  EFACTURA_I_AMB: "2",
  EFACTURA_EMISOR_CPBS_HON: "80131500",
  EFACTURA_EMISOR_CPBS_REI: "80131500",
  EFACTURA_API_BASE_URL: "https://sandbox.pac.example",
  EFACTURA_API_KEY: "test-key",
});

import { emitInvoiceToEfactura } from "@/lib/finanzas/efactura/orchestration/emit-invoice-to-efactura";

const TENANT = "a0000000-0000-0000-0000-000000000001";
const USER = "b0000000-0000-0000-0000-000000000002";
const INVOICE_ID = "c0000000-0000-0000-0000-000000000003";

type Row = Record<string, unknown>;

interface Backend {
  invoice: Row;
  feEmisiones: Array<Row & { id: string }>;
  seq: { ultimo: number };
}

function makeBackend(): Backend {
  return {
    invoice: {
      id: INVOICE_ID,
      invoice_number: "FAC-HON-000123",
      invoice_kind: "HONORARIOS",
      status: "emitida",
      fe_estado: "no_emitida",
      punto_facturacion: null,
      numero_documento: null,
    },
    feEmisiones: [],
    seq: { ultimo: 5 },
  };
}

const CLIENT_ROW: Row = {
  name: "MI CONDADO, S.A.",
  client_number: "CLI-057",
  client_status: "active",
  client_type: "persona_juridica",
  tax_id: "155555555-2-2020",
  tax_id_type: "ruc",
  ruc: null,
  email: "cliente@micondado.com",
  phone: null,
  address: "Calle 50",
  digito_verificador: "45",
  tipo_receptor_fe: "01",
  codigo_ubicacion: null,
  corregimiento: null,
  distrito: null,
  provincia: null,
  id_extranjero: null,
  pais_receptor: null,
};

const LINE: Row = {
  line_order: 0,
  description: "Honorarios legales",
  quantity: 1,
  unit_price: 100,
  tax_code: "ITBMS",
  tax_rate: 0.07,
  subtotal: 100,
  tax_amount: 7,
  line_total: 107,
};

class FakeQuery {
  private op: "select" | "insert" | "update" = "select";
  private selectCols = "";
  private payload: Row = {};
  private count = false;
  private filters: { eq: Record<string, unknown>; in?: { col: string; values: unknown[] } } = { eq: {} };

  constructor(private b: Backend, private table: string) {}

  select(cols: string): this { this.selectCols = cols; return this; }
  insert(payload: Row): this { this.op = "insert"; this.payload = payload; return this; }
  update(payload: Row, opts?: { count?: string }): this {
    this.op = "update";
    this.payload = payload;
    this.count = opts?.count === "exact";
    return this;
  }
  eq(col: string, val: unknown): this { this.filters.eq[col] = val; return this; }
  in(col: string, values: unknown[]): this { this.filters.in = { col, values }; return this; }
  order(): this { return this; }
  limit(): this { return this; }
  maybeSingle(): this { return this; }
  single(): this { return this; }

  then<T>(onF: (v: unknown) => T, onR?: (e: unknown) => T): Promise<T> {
    return Promise.resolve().then(() => this.resolve()).then(onF, onR);
  }

  private resolve(): unknown {
    const b = this.b;

    if (this.table === "invoices" && this.op === "select") {
      if (this.selectCols.includes("client:")) {
        return {
          data: {
            id: b.invoice.id,
            invoice_number: b.invoice.invoice_number,
            invoice_kind: b.invoice.invoice_kind,
            status: b.invoice.status,
            issue_date: "2026-08-01",
            due_date: "2026-08-11",
            notes: null,
            subtotal_total: 100,
            tax_total: 7,
            grand_total: 107,
            client_id: "client-1",
            client: CLIENT_ROW,
          },
          error: null,
        };
      }
      return {
        data: {
          id: b.invoice.id,
          status: b.invoice.status,
          fe_estado: b.invoice.fe_estado,
          punto_facturacion: b.invoice.punto_facturacion,
          numero_documento: b.invoice.numero_documento,
        },
        error: null,
      };
    }

    if (this.table === "invoice_lines" && this.op === "select") return { data: [LINE], error: null };

    if (this.table === "fe_emisiones" && this.op === "select") {
      const last = b.feEmisiones.length ? b.feEmisiones[b.feEmisiones.length - 1] : null;
      return { data: last ? { intento: last.intento } : null, error: null };
    }
    if (this.table === "fe_emisiones" && this.op === "insert") {
      const id = `emis-${b.feEmisiones.length + 1}`;
      b.feEmisiones.push({ id, ...this.payload });
      return { data: { id }, error: null };
    }
    if (this.table === "fe_emisiones" && this.op === "update") {
      const row = b.feEmisiones.find((e) => e.id === this.filters.eq.id);
      if (row) Object.assign(row, this.payload);
      return { error: null };
    }

    if (this.table === "invoices" && this.op === "update") {
      if (this.count) {
        const guard = this.filters.in;
        const ok = !!guard && guard.col === "fe_estado" && guard.values.includes(b.invoice.fe_estado);
        if (ok) { Object.assign(b.invoice, this.payload); return { count: 1, error: null }; }
        return { count: 0, error: null };
      }
      Object.assign(b.invoice, this.payload);
      return { error: null };
    }

    throw new Error(`FakeQuery: caso no manejado table=${this.table} op=${this.op}`);
  }
}

function makeDb(b: Backend) {
  return {
    from: (table: string) => new FakeQuery(b, table),
    // Emula allocate_fe_numero: incrementa y devuelve. No inspeccionamos los
    // argumentos acá — eso ya lo cubre emit-invoice-reuso-correlativo.test.ts.
    rpc: () => {
      b.seq.ultimo += 1;
      return Promise.resolve({ data: b.seq.ultimo, error: null });
    },
  };
}

/** Stub de fetch que devuelve un RECHAZO del PAC con los gResProc dados. */
function stubFetchRejected(gResProc: Array<{ dCodRes?: string; dMsgRes?: string }>): () => void {
  const original = global.fetch;
  global.fetch = (async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => "application/json" },
    json: async () => ({
      autorizada: false,
      invoice: "ef-uuid-rechazo",
      rRetEnviFe: { xProtFe: { rProtFe: { gInfProt: { gResProc } } } },
    }),
    text: async () => "",
  })) as unknown as typeof fetch;
  return () => { global.fetch = original; };
}

// ---------------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------------

test("E2E CASO REAL: rechazo 1601/1602 → NO aparece el mensaje de duplicado", async () => {
  const b = makeBackend();
  const restore = stubFetchRejected([
    { dCodRes: "1601", dMsgRes: "Regla de formación del RUC inválida" },
    { dCodRes: "1602", dMsgRes: "RUC inexistente en el Registro Único de Contribuyentes" },
  ]);
  try {
    const res = await emitInvoiceToEfactura(makeDb(b) as never, TENANT, USER, INVOICE_ID);

    assert.equal(res.feEstado, "error");
    assert.equal(res.errorKind, "pac_rejected", "NO debe ser pac_duplicate");

    const msg = (res.errorMessage ?? "").toLowerCase();
    assert.equal(msg.includes("ya existe"), false);
    assert.equal(msg.includes("posiblemente ya fue autorizado"), false);

    // El motivo real sí está, y los códigos siguen viajando como referencia.
    assert.match(res.errorMessage ?? "", /1601/);
    assert.equal(res.codRes.length, 2);
    assert.equal(res.codRes[1].dCodRes, "1602");

    // Guía accionable en lenguaje claro.
    assert.match(res.errorHint ?? "", /RUC del cliente parece inválido o incompleto/);
    assert.match(res.errorHint ?? "", /ficha del cliente/);
  } finally {
    restore();
  }
});

test("E2E: el errorKind PERSISTIDO en fe_emisiones también es pac_rejected", async () => {
  const b = makeBackend();
  const restore = stubFetchRejected([
    { dCodRes: "1602", dMsgRes: "RUC inexistente en el Registro Único de Contribuyentes" },
  ]);
  try {
    await emitInvoiceToEfactura(makeDb(b) as never, TENANT, USER, INVOICE_ID);
    const emision = b.feEmisiones[0];
    const payload = emision.response_payload as { _meta: { errorKind: string } };
    assert.equal(payload._meta.errorKind, "pac_rejected");
    assert.equal(emision.autorizada, false);
    assert.equal(b.invoice.fe_estado, "error");
  } finally {
    restore();
  }
});

test("E2E: duplicado SIN códigos de rechazo → sí muestra el mensaje de duplicado", async () => {
  const b = makeBackend();
  const restore = stubFetchRejected([
    { dCodRes: "0300", dMsgRes: "El documento ya existe y fue autorizado previamente" },
  ]);
  try {
    const res = await emitInvoiceToEfactura(makeDb(b) as never, TENANT, USER, INVOICE_ID);

    assert.equal(res.feEstado, "error");
    assert.equal(res.errorKind, "pac_duplicate");
    assert.match(res.errorMessage ?? "", /ya existe/);
    assert.match(res.errorMessage ?? "", /Posiblemente ya fue autorizado/);
    assert.equal(res.errorHint, null);

    const payload = b.feEmisiones[0].response_payload as { _meta: { errorKind: string } };
    assert.equal(payload._meta.errorKind, "pac_duplicate");
  } finally {
    restore();
  }
});

test("E2E: duplicado + código de rechazo mezclados → gana el rechazo", async () => {
  const b = makeBackend();
  const restore = stubFetchRejected([
    { dCodRes: "0300", dMsgRes: "El documento ya existe" },
    { dCodRes: "1601", dMsgRes: "Regla de formación del RUC inválida" },
  ]);
  try {
    const res = await emitInvoiceToEfactura(makeDb(b) as never, TENANT, USER, INVOICE_ID);
    assert.equal(res.errorKind, "pac_rejected");
    assert.equal((res.errorMessage ?? "").toLowerCase().includes("ya existe"), false);
    assert.match(res.errorMessage ?? "", /1601/);
    // Los DOS códigos siguen disponibles como detalle técnico.
    assert.equal(res.codRes.length, 2);
  } finally {
    restore();
  }
});
