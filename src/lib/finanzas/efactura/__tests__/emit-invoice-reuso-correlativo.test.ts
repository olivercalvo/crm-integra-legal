/**
 * Tests de la política de REUSO del correlativo FE en la orquestación de
 * emisión al PAC (`emitInvoiceToEfactura`).
 *
 * Ejecución:
 *   npx tsx --test src/lib/finanzas/efactura/__tests__/emit-invoice-reuso-correlativo.test.ts
 *
 * Contexto (2026-07-14): el PAC (Ideati) confirmó que los números NO
 * autorizados (que nunca recibieron CUFE) SE PUEDEN REUTILIZAR. Antes, un
 * throw del mapper entre el allocate (T1) y la reserva (antes T2.a) dejaba la
 * factura en 'no_emitida' SIN número persistido, así que el reuso D-3 nunca
 * era alcanzable y cada reintento quemaba OTRO correlativo (caso real
 * FAC-REI-000039: quemó 3, 4 y 5). El fix mueve la reserva del número EN LA
 * FACTURA a ANTES del mapper (T1.5), y atrapa el throw del mapper dejando la
 * factura 'error' con el número ya guardado → el reintento lo reusa (D-3).
 *
 * Estos tests usan un fake in-memory del cliente Supabase (el builder fluido
 * y `rpc`) para ejercitar la orquestación completa sin BD ni red real. El
 * transport (`post`) usa `global.fetch`, que se stubbea en el camino feliz.
 *
 * Cubren:
 *   - Un intento fallido por el mapper NO quema el número: queda reservado en
 *     la factura y fe_estado='error'.
 *   - El siguiente intento REUSA ese mismo número, sin volver a llamar al
 *     allocator.
 *   - Un número YA autorizado (con CUFE) nunca se re-emite ni se re-allocatea
 *     (gate T0).
 *   - Atomicidad: el guard de la reserva rechaza (409) al proceso que perdió
 *     la carrera, sin doble-procesar.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { MutationError } from "@/lib/finanzas/api/errors";

// ---------------------------------------------------------------------------
// Entorno del emisor + transport (leídos lazy por loadEmisorConfig()/loadConfig()).
// ---------------------------------------------------------------------------
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

// Importado DESPUÉS de setear env (el módulo no lee env en import, pero por
// prolijidad lo dejamos acá).
import { emitInvoiceToEfactura } from "@/lib/finanzas/efactura/orchestration/emit-invoice-to-efactura";

const TENANT = "a0000000-0000-0000-0000-000000000001";
const USER = "b0000000-0000-0000-0000-000000000002";
const INVOICE_ID = "c0000000-0000-0000-0000-000000000003";

// ---------------------------------------------------------------------------
// Fake in-memory de Supabase.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface Backend {
  invoice: Row;
  clientRow: Row;
  lines: Row[];
  feEmisiones: Array<Row & { id: string }>;
  seq: { ultimo: number };
  allocateCalls: number;
  /** Hook para simular una carrera: se dispara tras leer el meta (T0). */
  afterMetaRead?: () => void;
}

function buildHeader(b: Backend): Row {
  return {
    id: b.invoice.id,
    invoice_number: b.invoice.invoice_number,
    invoice_kind: b.invoice.invoice_kind,
    status: b.invoice.status,
    issue_date: "2026-07-14",
    due_date: "2026-07-24",
    notes: null,
    subtotal_total: 100,
    tax_total: 7,
    grand_total: 107,
    client_id: "client-1",
    client: b.clientRow,
  };
}

class FakeQuery {
  private op: "select" | "insert" | "update" = "select";
  private selectCols = "";
  private payload: Row = {};
  private count = false;
  private filters: { eq: Record<string, unknown>; in?: { col: string; values: unknown[] } } = {
    eq: {},
  };

  constructor(private backend: Backend, private table: string) {}

  select(cols: string): this {
    this.selectCols = cols;
    return this;
  }
  insert(payload: Row): this {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: Row, opts?: { count?: string }): this {
    this.op = "update";
    this.payload = payload;
    this.count = opts?.count === "exact";
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters.eq[col] = val;
    return this;
  }
  in(col: string, values: unknown[]): this {
    this.filters.in = { col, values };
    return this;
  }
  order(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  maybeSingle(): this {
    return this;
  }
  single(): this {
    return this;
  }

  then<T>(onF: (v: unknown) => T, onR?: (e: unknown) => T): Promise<T> {
    return Promise.resolve().then(() => this.resolve()).then(onF, onR);
  }

  private resolve(): unknown {
    const b = this.backend;

    if (this.table === "invoices" && this.op === "select") {
      if (this.selectCols.includes("client:")) {
        return { data: buildHeader(b), error: null };
      }
      // loadInvoiceMeta — snapshot ANTES de un posible flip de carrera.
      const snap = {
        id: b.invoice.id,
        status: b.invoice.status,
        fe_estado: b.invoice.fe_estado,
        punto_facturacion: b.invoice.punto_facturacion,
        numero_documento: b.invoice.numero_documento,
      };
      if (b.afterMetaRead) b.afterMetaRead();
      return { data: snap, error: null };
    }

    if (this.table === "invoice_lines" && this.op === "select") {
      return { data: b.lines, error: null };
    }

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
        // Reserva (T1.5): lock optimista vía guard fe_estado IN (...).
        const guard = this.filters.in;
        const ok =
          !!guard &&
          guard.col === "fe_estado" &&
          guard.values.includes(b.invoice.fe_estado);
        if (ok) {
          Object.assign(b.invoice, this.payload);
          return { count: 1, error: null };
        }
        return { count: 0, error: null };
      }
      Object.assign(b.invoice, this.payload);
      return { error: null };
    }

    throw new Error(
      `FakeQuery: caso no manejado table=${this.table} op=${this.op} cols=${this.selectCols}`
    );
  }
}

function makeDb(b: Backend) {
  return {
    from(table: string) {
      return new FakeQuery(b, table);
    },
    rpc(name: string, args: Record<string, unknown>) {
      if (name !== "allocate_fe_numero") {
        return Promise.resolve({ data: null, error: { message: `rpc desconocido ${name}` } });
      }
      // Emula el UPSERT atómico: incrementa ultimo_numero y lo devuelve.
      assert.equal(args.p_tenant_id, TENANT);
      assert.equal(args.p_punto_facturacion, "051");
      b.allocateCalls += 1;
      b.seq.ultimo += 1;
      return Promise.resolve({ data: b.seq.ultimo, error: null });
    },
  };
}

function baseClientRow(): Row {
  // Receptor 01 (contribuyente) que PASA el gate fiscal.
  return {
    name: "ACME, S.A.",
    client_number: "CLI-100",
    client_status: "active",
    client_type: "persona_juridica",
    tax_id: "155555555-2-2020",
    tax_id_type: "ruc",
    ruc: null,
    email: "cliente@acme.com",
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
}

function line(taxRate: number): Row {
  return {
    line_order: 0,
    description: "Honorarios legales",
    quantity: 1,
    unit_price: 100,
    tax_code: "ITBMS",
    tax_rate: taxRate,
    subtotal: 100,
    tax_amount: 7,
    line_total: 107,
  };
}

function makeBackend(overrides?: Partial<Backend>): Backend {
  return {
    invoice: {
      id: INVOICE_ID,
      invoice_number: "FAC-REI-000039",
      invoice_kind: "REEMBOLSABLES",
      status: "emitida",
      fe_estado: "no_emitida",
      punto_facturacion: null,
      numero_documento: null,
    },
    clientRow: baseClientRow(),
    lines: [line(0.07)],
    feEmisiones: [],
    seq: { ultimo: 5 }, // como el punto 051 real: 1..5 ya consumidos.
    allocateCalls: 0,
    ...overrides,
  };
}

/** Stub de fetch que devuelve una autorización válida del PAC. */
function stubFetchAuthorized(cufe: string): () => void {
  const original = global.fetch;
  global.fetch = (async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => "application/json" },
    json: async () => ({
      autorizada: true,
      cufe,
      protocoloAutorizacion: "PROT-123",
      fechaAutorizacion: "2026-07-14T10:00:00-05:00",
      qrContent: "https://dgi.mef.gob.pa/qr?chFE=" + cufe,
      invoice: "ef-uuid-1",
    }),
    text: async () => "",
  })) as unknown as typeof fetch;
  return () => {
    global.fetch = original;
  };
}

// ---------------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------------

test("intento fallido por el mapper deja el número RESERVADO (no lo quema) y fe_estado='error'", async () => {
  const b = makeBackend({ lines: [line(0.05)] }); // 5% no está en ITBMS_RATE_TO_CODE → mapper lanza.
  const db = makeDb(b);

  await assert.rejects(
    () => emitInvoiceToEfactura(db as never, TENANT, USER, INVOICE_ID),
    (err: unknown) => {
      assert.ok(err instanceof MutationError, "debe ser MutationError");
      assert.match((err as MutationError).message, /documento electrónico/);
      return true;
    }
  );

  // El allocator corrió UNA vez (número 6) y el número quedó guardado en la
  // factura, que está 'error' (reusable), NO 'no_emitida'.
  assert.equal(b.allocateCalls, 1, "allocate corre una sola vez");
  assert.equal(b.seq.ultimo, 6, "fe_secuencias avanzó a 6");
  assert.equal(b.invoice.fe_estado, "error", "la factura queda en 'error' (reusable)");
  assert.equal(b.invoice.numero_documento, 6, "el número 6 quedó reservado en la factura");
  assert.equal(b.invoice.punto_facturacion, "051");
});

test("el siguiente intento REUSA el mismo número (D-3) sin volver a allocar", async () => {
  // Arrancamos como quedó el test anterior: factura 'error' con numero=6.
  const b = makeBackend({
    lines: [line(0.05)],
    invoice: {
      id: INVOICE_ID,
      invoice_number: "FAC-REI-000039",
      invoice_kind: "REEMBOLSABLES",
      status: "emitida",
      fe_estado: "no_emitida",
      punto_facturacion: null,
      numero_documento: null,
    },
  });
  const db = makeDb(b);

  // 1er intento: falla en el mapper, reserva el 6.
  await assert.rejects(() => emitInvoiceToEfactura(db as never, TENANT, USER, INVOICE_ID));
  assert.equal(b.allocateCalls, 1);
  assert.equal(b.invoice.numero_documento, 6);
  assert.equal(b.invoice.fe_estado, "error");

  // Se corrige la causa (tasa válida) y el PAC ahora autoriza.
  b.lines = [line(0.07)];
  const restore = stubFetchAuthorized("FE-CUFE-OK");
  try {
    const res = await emitInvoiceToEfactura(db as never, TENANT, USER, INVOICE_ID);

    // CLAVE: NO se volvió a llamar al allocator; se reusó el 6.
    assert.equal(b.allocateCalls, 1, "no se allocó un número nuevo en el reintento");
    assert.equal(b.seq.ultimo, 6, "fe_secuencias NO avanzó más allá de 6");
    assert.equal(res.numeroDocumento, 6, "la emisión exitosa usó el 6 reusado");
    assert.equal(res.feEstado, "authorized");
    assert.equal(res.cufe, "FE-CUFE-OK");
    assert.equal(b.invoice.fe_estado, "authorized");
    assert.equal(b.invoice.numero_documento, 6);
    assert.equal(b.invoice.dgi_cufe, "FE-CUFE-OK");
  } finally {
    restore();
  }
});

test("un número YA autorizado (con CUFE) NUNCA se re-emite ni se re-allocatea (gate T0)", async () => {
  const b = makeBackend({
    invoice: {
      id: INVOICE_ID,
      invoice_number: "FAC-REI-000006",
      invoice_kind: "REEMBOLSABLES",
      status: "emitida",
      fe_estado: "authorized",
      punto_facturacion: "051",
      numero_documento: 6,
      dgi_cufe: "FE-CUFE-YA",
    },
    seq: { ultimo: 6 },
  });
  const db = makeDb(b);

  await assert.rejects(
    () => emitInvoiceToEfactura(db as never, TENANT, USER, INVOICE_ID),
    (err: unknown) => {
      assert.ok(err instanceof MutationError);
      assert.equal((err as MutationError).status, 409);
      assert.match((err as MutationError).message, /ya fue autorizada/i);
      return true;
    }
  );

  assert.equal(b.allocateCalls, 0, "no se allocó ningún número");
  assert.equal(b.seq.ultimo, 6, "fe_secuencias intacta");
  assert.equal(b.invoice.numero_documento, 6, "el número autorizado no se tocó");
  assert.equal(b.invoice.fe_estado, "authorized");
});

test("atomicidad: el guard de la reserva rechaza (409) al proceso que perdió la carrera", async () => {
  // Simula que, entre el read del meta (T0, ve 'no_emitida') y la reserva
  // (T1.5), OTRO proceso ya movió la factura a 'pending'. El guard
  // fe_estado IN ('no_emitida','error') no matchea → count=0 → 409, sin
  // doble-INSERT en fe_emisiones.
  const b = makeBackend();
  b.afterMetaRead = () => {
    b.invoice.fe_estado = "pending";
  };
  const db = makeDb(b);

  await assert.rejects(
    () => emitInvoiceToEfactura(db as never, TENANT, USER, INVOICE_ID),
    (err: unknown) => {
      assert.ok(err instanceof MutationError);
      assert.equal((err as MutationError).status, 409);
      assert.match((err as MutationError).message, /Otro proceso/i);
      return true;
    }
  );

  // El proceso perdedor no insertó ningún intento (no hubo doble-procesamiento).
  assert.equal(b.feEmisiones.length, 0, "no se insertó fe_emisiones");
});
