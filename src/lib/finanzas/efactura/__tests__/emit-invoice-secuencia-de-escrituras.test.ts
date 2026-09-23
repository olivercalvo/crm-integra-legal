/**
 * 🔒 LA SECUENCIA DE ESCRITURAS DE `emitInvoiceToEfactura`, CONGELADA.
 *
 * Ejecución:
 *   npx tsx --test src/lib/finanzas/efactura/__tests__/emit-invoice-secuencia-de-escrituras.test.ts
 *
 * Los tests que ya existían sobre el orquestador miran el RESULTADO: que el
 * correlativo se reuse, que el rechazo no se confunda con un duplicado. Ninguno
 * mira el ORDEN, y el orden es justamente donde vive lo que este módulo hace
 * bien y nadie volvería a deducir leyéndolo:
 *
 *   - el número se RESERVA en la factura antes de que corra el mapper, que es
 *     la primera pieza que puede lanzar;
 *   - el payload que se le va a mandar al PAC se GUARDA antes del POST;
 *   - al volver, el registro del intento se cierra antes de tocar la factura.
 *
 * Cada una de esas tres cosas es una decisión sobre qué queda en la base si el
 * proceso se muere en el peor momento posible. Un refactor que reordene dos
 * `await` las deshace sin romper ningún otro test, sin cambiar ninguna firma y
 * sin que se note hasta que un envío real se corte por la mitad.
 *
 * Por eso este archivo no verifica valores: verifica la SECUENCIA. Un fake del
 * cliente de Supabase anota cada operación —tabla, verbo, columnas tocadas— en
 * un diario, el POST se anota en el mismo diario, y los caminos que puede tomar
 * una emisión quedan escritos acá como listas literales.
 *
 * ⚠️ SI ESTE TEST FALLA, LA PREGUNTA NO ES "¿CÓMO ACTUALIZO LA LISTA?".
 * Es: ¿qué pasa ahora si el proceso muere entre la operación que se movió y la
 * siguiente? Si la respuesta es buena, se actualiza la lista Y se explica en el
 * commit. Si nadie se hizo la pregunta, el reordenamiento no debería entrar.
 *
 * Este archivo es parte de la red del Bloque 9A: se escribe ANTES de tocar el
 * orquestador para la anulación ante la DGI (9B), no después.
 */

import test from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Entorno del emisor. Sandbox (i_amb = 2) — nunca el ambiente real.
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

import { emitInvoiceToEfactura } from "@/lib/finanzas/efactura/orchestration/emit-invoice-to-efactura";

const TENANT = "a0000000-0000-0000-0000-000000000001";
const USER = "b0000000-0000-0000-0000-000000000002";
const INVOICE_ID = "c0000000-0000-0000-0000-000000000003";

// ---------------------------------------------------------------------------
// El diario
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function anotarLectura(diario: string[], tabla: string, que: string): void {
  diario.push(`SELECT ${tabla} (${que})`);
}

function anotarEscritura(
  diario: string[],
  verbo: "INSERT" | "UPDATE" | "RPC",
  tabla: string,
  payload: Row,
  extra = ""
): void {
  const cols = verbo === "RPC" ? "" : ` {${Object.keys(payload).sort().join(", ")}}`;
  diario.push(`${verbo} ${tabla}${cols}${extra}`);
}

// ---------------------------------------------------------------------------
// Fake in-memory de Supabase que anota todo lo que pasa por él.
// ---------------------------------------------------------------------------

interface Backend {
  invoice: Row;
  clientRow: Row;
  lines: Row[];
  feEmisiones: Array<Row & { id: string }>;
  seq: { ultimo: number };
  diario: string[];
}

function buildHeader(b: Backend): Row {
  return {
    id: b.invoice.id,
    invoice_number: b.invoice.invoice_number,
    invoice_kind: b.invoice.invoice_kind,
    status: b.invoice.status,
    issue_date: "2026-09-15",
    due_date: "2026-09-25",
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

  constructor(
    private backend: Backend,
    private table: string
  ) {}

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
    return Promise.resolve()
      .then(() => this.resolve())
      .then(onF, onR);
  }

  private resolve(): unknown {
    const b = this.backend;
    const d = b.diario;

    if (this.table === "invoices" && this.op === "select") {
      if (this.selectCols.includes("client:")) {
        anotarLectura(d, "invoices", "bundle + cliente");
        return { data: buildHeader(b), error: null };
      }
      anotarLectura(d, "invoices", "meta: status y fe_estado");
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

    if (this.table === "invoice_lines" && this.op === "select") {
      anotarLectura(d, "invoice_lines", "líneas");
      return { data: b.lines, error: null };
    }

    if (this.table === "fe_emisiones" && this.op === "select") {
      anotarLectura(d, "fe_emisiones", "último intento");
      const last = b.feEmisiones.length ? b.feEmisiones[b.feEmisiones.length - 1] : null;
      return { data: last ? { intento: last.intento } : null, error: null };
    }

    if (this.table === "fe_emisiones" && this.op === "insert") {
      // El payload del PAC se guarda ACÁ, antes del POST. Lo anotamos como
      // parte de la línea: un INSERT que no lo trajera sería exactamente la
      // regresión que este archivo existe para atrapar.
      const conPayload = this.payload.request_payload ? " ← el documento, ANTES del POST" : "";
      anotarEscritura(d, "INSERT", "fe_emisiones", this.payload, conPayload);
      const id = `emis-${b.feEmisiones.length + 1}`;
      b.feEmisiones.push({ id, ...this.payload });
      return { data: { id }, error: null };
    }

    if (this.table === "fe_emisiones" && this.op === "update") {
      anotarEscritura(d, "UPDATE", "fe_emisiones", this.payload);
      const row = b.feEmisiones.find((e) => e.id === this.filters.eq.id);
      if (row) Object.assign(row, this.payload);
      return { error: null };
    }

    if (this.table === "invoices" && this.op === "update") {
      if (this.count) {
        const guard = this.filters.in;
        const ok =
          !!guard && guard.col === "fe_estado" && guard.values.includes(b.invoice.fe_estado);
        anotarEscritura(
          d,
          "UPDATE",
          "invoices",
          this.payload,
          ` guard=fe_estado IN (${(guard?.values ?? []).join("|")})`
        );
        if (ok) {
          Object.assign(b.invoice, this.payload);
          return { count: 1, error: null };
        }
        return { count: 0, error: null };
      }
      anotarEscritura(d, "UPDATE", "invoices", this.payload);
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
      anotarEscritura(
        b.diario,
        "RPC",
        "allocate_fe_numero",
        {},
        ` punto=${String(args.p_punto_facturacion)}`
      );
      b.seq.ultimo += 1;
      return Promise.resolve({ data: b.seq.ultimo, error: null });
    },
  };
}

function baseClientRow(): Row {
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
      invoice_number: "FAC-HON-000123",
      invoice_kind: "HONORARIOS",
      status: "emitida",
      fe_estado: "no_emitida",
      punto_facturacion: null,
      numero_documento: null,
    },
    clientRow: baseClientRow(),
    lines: [line(0.07)],
    feEmisiones: [],
    seq: { ultimo: 5 },
    diario: [],
    ...overrides,
  };
}

/**
 * Stub de `fetch` que anota el POST en el MISMO diario que las escrituras de
 * base. Sin eso no se podría ver lo único que importa acá: qué quedó escrito
 * antes de salir a la red y qué después.
 */
function stubFetch(b: Backend, responder: () => unknown): () => void {
  const original = global.fetch;
  global.fetch = (async (url: string) => {
    const path = String(url).replace("https://sandbox.pac.example", "");
    b.diario.push(`POST ${path}  ⟵ el PAC`);
    const body = responder();
    if (body instanceof Error) throw body;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => "application/json" },
      json: async () => body,
      text: async () => "",
    };
  }) as unknown as typeof fetch;
  return () => {
    global.fetch = original;
  };
}

const RESPUESTA_AUTORIZADA = {
  autorizada: true,
  cufe: "FE0120000001234567",
  protocoloAutorizacion: "PROT-9001",
  fechaAutorizacion: "2026-09-15T10:00:00-05:00",
  qrContent: "https://dgi.mef.gob.pa/qr?chFE=FE0120000001234567",
  invoice: "ef-uuid-1",
};

const RESPUESTA_RECHAZADA = {
  autorizada: false,
  invoice: "ef-uuid-2",
  rRetEnviFe: {
    xProtFe: {
      rProtFe: {
        gInfProt: {
          gResProc: [{ dCodRes: "1602", dMsgRes: "RUC del receptor inexistente" }],
        },
      },
    },
  },
};

/** HTTP 200 con UUID del PAC pero sin CUFE: aceptada, no confirmada. */
const RESPUESTA_PENDIENTE = { invoice: "ef-uuid-3" };

/** Corre una emisión completa y devuelve el diario. */
async function correr(
  responder: () => unknown,
  overrides?: Partial<Backend>
): Promise<{ b: Backend; diario: string[] }> {
  const b = makeBackend(overrides);
  const db = makeDb(b);
  const restore = stubFetch(b, responder);
  try {
    await emitInvoiceToEfactura(db as never, TENANT, USER, INVOICE_ID);
  } finally {
    restore();
  }
  return { b, diario: b.diario };
}

// ---------------------------------------------------------------------------
// LOS CUATRO CAMINOS, CONGELADOS
// ---------------------------------------------------------------------------

/** El tramo común: todo lo que pasa antes de saber qué contestó el PAC. */
const HASTA_EL_POST = [
  "SELECT invoices (meta: status y fe_estado)",
  "SELECT invoices (bundle + cliente)",
  "SELECT invoice_lines (líneas)",
  "SELECT fe_emisiones (último intento)",
  "RPC allocate_fe_numero punto=051",
  "UPDATE invoices {fe_estado, i_amb, numero_documento, punto_facturacion} guard=fe_estado IN (no_emitida|error)",
  "INSERT fe_emisiones {autorizada, created_by, i_amb, intento, invoice_id, numero_documento, punto_facturacion, request_payload, tenant_id} ← el documento, ANTES del POST",
  "POST /api/v1/Invoices?qr=true&xml=false  ⟵ el PAC",
];

test("🔒 camino AUTORIZADA: la secuencia completa", async () => {
  const { diario, b } = await correr(() => RESPUESTA_AUTORIZADA);

  assert.deepEqual(diario, [
    ...HASTA_EL_POST,
    // El intento se cierra PRIMERO. Si el proceso muere acá, el CUFE ya está
    // en la base y la factura queda 'pending' — recuperable. Al revés se
    // perdería la respuesta del PAC, que es lo único que no se puede rehacer.
    "UPDATE fe_emisiones {autorizada, cod_res, cufe, fecha_autorizacion, protocolo_autorizacion, response_payload}",
    "UPDATE invoices {dgi_cufe, dgi_fecha_autorizacion, dgi_protocolo_autorizacion, ef_invoice_uuid, fe_estado, qr_content}",
  ]);
  assert.equal(b.invoice.fe_estado, "authorized");
  assert.equal(b.invoice.dgi_cufe, RESPUESTA_AUTORIZADA.cufe);
});

test("🔒 camino RECHAZADA por el PAC: la secuencia completa", async () => {
  const { diario, b } = await correr(() => RESPUESTA_RECHAZADA);

  assert.deepEqual(diario, [
    ...HASTA_EL_POST,
    "UPDATE fe_emisiones {autorizada, cod_res, response_payload}",
    "UPDATE invoices {ef_invoice_uuid, fe_estado}",
  ]);
  assert.equal(b.invoice.fe_estado, "error", "'error' es reintentable: el número se reusa");
  assert.equal(b.invoice.numero_documento, 6, "y sigue reservado en la factura");
});

test("🔒 camino INCIERTO (no sabemos qué contestó): la secuencia completa", async () => {
  // Antes esto se llamaba `pending_async` y dejaba la factura en 'pending', que
  // el gate T0 considera intocable: nadie podía reenviarla y el reconciliador
  // que iba a destrabarla no existe. Una respuesta que no entendemos no puede
  // dejar el documento en un estado del que no se sale.
  const { diario, b } = await correr(() => RESPUESTA_PENDIENTE);

  assert.deepEqual(diario, [
    ...HASTA_EL_POST,
    "UPDATE fe_emisiones {autorizada, cod_res, response_payload}",
    "UPDATE invoices {ef_invoice_uuid}",
    "UPDATE invoices {fe_estado}",
  ]);
  assert.equal(b.invoice.fe_estado, "error", "'error' es REINTENTABLE");
});

test("🔴 INCIERTO no es un rechazo: el mensaje dice 'Estado por confirmar'", async () => {
  // Es la lección del `0600`: el clasificador de anulación llamó rechazo a un
  // éxito porque el código no estaba en su lista. Acá, decirle a la licenciada
  // "la DGI rechazó" sobre algo que no entendimos la manda a corregir una
  // factura que puede estar perfecta.
  const { b } = await correr(() => RESPUESTA_PENDIENTE);
  const emision = b.feEmisiones[0];
  const payload = emision.response_payload as Record<string, unknown>;
  const meta = payload?._meta as Record<string, unknown> | undefined;
  assert.equal(meta?.errorKind, "incierto", "queda registrado como incierto, no como rechazo");
});

test("🔴 con códigos pero SIN `autorizada: false`, tampoco es rechazo", async () => {
  // El atajo "si hay códigos, rechazó" es el que produjo el bug del 0600.
  // El PAC manda `autorizada` SIEMPRE y explícito: si no está, no dictaminó.
  const { b } = await correr(() => ({
    invoice: "ef-uuid-9",
    rRetEnviFe: {
      xProtFe: {
        rProtFe: { gInfProt: { gResProc: [{ dCodRes: "7777", dMsgRes: "Algo nuevo" }] } },
      },
    },
  }));
  assert.equal(b.invoice.fe_estado, "error", "reintentable");
  const meta = (b.feEmisiones[0].response_payload as Record<string, unknown>)?._meta as
    | Record<string, unknown>
    | undefined;
  assert.equal(meta?.errorKind, "incierto");
});

test("🔒 camino SE CAYÓ LA RED: la secuencia completa", async () => {
  const { diario, b } = await correr(() => new Error("ECONNRESET"));

  assert.deepEqual(diario, [
    ...HASTA_EL_POST,
    "UPDATE fe_emisiones {autorizada, response_payload}",
    "UPDATE invoices {fe_estado}",
  ]);
  assert.equal(b.invoice.fe_estado, "error");
  assert.equal(b.invoice.numero_documento, 6, "el número NO se quema");
});

test("🔒 camino EL MAPPER LANZÓ: se reserva el número y no se sale a la red", async () => {
  const b = makeBackend({ lines: [line(0.05)] }); // 5% no mapea a un código de ITBMS
  const db = makeDb(b);
  const restore = stubFetch(b, () => RESPUESTA_AUTORIZADA);
  try {
    await assert.rejects(() => emitInvoiceToEfactura(db as never, TENANT, USER, INVOICE_ID));
  } finally {
    restore();
  }

  assert.deepEqual(b.diario, [
    "SELECT invoices (meta: status y fe_estado)",
    "SELECT invoices (bundle + cliente)",
    "SELECT invoice_lines (líneas)",
    "SELECT fe_emisiones (último intento)",
    "RPC allocate_fe_numero punto=051",
    // La reserva ya ocurrió: por eso el número sobrevive al throw de abajo.
    "UPDATE invoices {fe_estado, i_amb, numero_documento, punto_facturacion} guard=fe_estado IN (no_emitida|error)",
    "UPDATE invoices {fe_estado}",
  ]);
  assert.equal(b.invoice.numero_documento, 6);
  assert.equal(b.invoice.fe_estado, "error");
});

// ---------------------------------------------------------------------------
// LAS REGLAS QUE EL ORDEN SOSTIENE
//
// Los cinco tests de arriba congelan; estos cinco dicen POR QUÉ. Si mañana se
// agrega un camino nuevo —la anulación ante la DGI, el reconciliador— estos
// siguen aplicando y aquellos no.
// ---------------------------------------------------------------------------

/** Los cuatro caminos que llegan a hablar con el PAC. */
const CAMINOS = [
  { nombre: "autorizada", responder: () => RESPUESTA_AUTORIZADA },
  { nombre: "rechazada", responder: () => RESPUESTA_RECHAZADA },
  { nombre: "pending", responder: () => RESPUESTA_PENDIENTE },
  { nombre: "red caída", responder: () => new Error("ECONNRESET") },
];

test("🔴 el número se RESERVA en la factura antes del POST, en todos los caminos", async () => {
  for (const c of CAMINOS) {
    const { diario } = await correr(c.responder);
    const reserva = diario.findIndex((l) => l.includes("numero_documento") && l.includes("guard="));
    const post = diario.findIndex((l) => l.startsWith("POST "));
    assert.ok(reserva >= 0, `"${c.nombre}": no hubo reserva`);
    assert.ok(
      reserva < post,
      `"${c.nombre}": el POST salió ANTES de reservar el número. Si el proceso muere con ` +
        `el documento ya en la DGI y la factura sin número, el reintento pide OTRO ` +
        `correlativo y emite el mismo documento dos veces.`
    );
  }
});

test("🔴 el documento que se le manda al PAC se GUARDA antes del POST", async () => {
  for (const c of CAMINOS) {
    const { diario } = await correr(c.responder);
    const guardado = diario.findIndex((l) => l.includes("request_payload"));
    const post = diario.findIndex((l) => l.startsWith("POST "));
    assert.ok(
      guardado >= 0 && guardado < post,
      `"${c.nombre}": el payload se guardó después del POST (o no se guardó). Un envío ` +
        `interrumpido dejaría a la DGI con un documento del que acá no queda rastro de ` +
        `qué se mandó.`
    );
  }
});

test("🔴 al volver del PAC, se cierra el INTENTO antes de tocar la FACTURA", async () => {
  for (const c of CAMINOS) {
    const { diario } = await correr(c.responder);
    const post = diario.findIndex((l) => l.startsWith("POST "));
    const despues = diario.slice(post + 1);
    const intento = despues.findIndex((l) => l.startsWith("UPDATE fe_emisiones"));
    const factura = despues.findIndex((l) => l.startsWith("UPDATE invoices"));
    assert.ok(
      intento >= 0 && factura >= 0 && intento < factura,
      `"${c.nombre}": la factura se actualizó antes que el registro del intento. La ` +
        `respuesta del PAC es lo único que no se puede volver a generar: se escribe primero.`
    );
  }
});

test("🔴 nadie escribe el CUFE en la factura si el PAC no autorizó", async () => {
  for (const c of CAMINOS) {
    if (c.nombre === "autorizada") continue;
    const { diario, b } = await correr(c.responder);
    const conCufe = diario.filter((l) => l.startsWith("UPDATE invoices") && l.includes("dgi_cufe"));
    assert.equal(
      conCufe.length,
      0,
      `"${c.nombre}": se tocó dgi_cufe sin autorización del PAC — ${conCufe.join(" / ")}`
    );
    assert.equal(b.invoice.dgi_cufe, undefined);
  }
});

test("🔴 el allocator corre UNA sola vez por emisión, en todos los caminos", async () => {
  for (const c of CAMINOS) {
    const { diario, b } = await correr(c.responder);
    const llamadas = diario.filter((l) => l.startsWith("RPC allocate_fe_numero"));
    assert.equal(llamadas.length, 1, `"${c.nombre}": el allocator corrió ${llamadas.length} veces`);
    assert.equal(b.seq.ultimo, 6, `"${c.nombre}": la secuencia avanzó de más`);
  }
});

test("una emisión que arranca en 'error' REUSA el número y no llama al allocator", async () => {
  const { diario, b } = await correr(() => RESPUESTA_AUTORIZADA, {
    invoice: {
      id: INVOICE_ID,
      invoice_number: "FAC-HON-000123",
      invoice_kind: "HONORARIOS",
      status: "emitida",
      fe_estado: "error",
      punto_facturacion: "051",
      numero_documento: 4,
    },
  });

  assert.equal(
    diario.filter((l) => l.startsWith("RPC allocate_fe_numero")).length,
    0,
    "el reintento no pide un número nuevo"
  );
  assert.equal(b.seq.ultimo, 5, "la secuencia no se movió");
  assert.equal(b.invoice.numero_documento, 4, "se reusó el 4");
  assert.equal(b.invoice.fe_estado, "authorized");
});
