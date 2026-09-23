/**
 * 🔒 LA SECUENCIA DE LA ANULACIÓN FISCAL, CONGELADA.
 *
 * Ejecución (requiere el flag experimental para `mock.module`):
 *   npx tsx --test --experimental-test-module-mocks \
 *     src/lib/finanzas/efactura/__tests__/anular-factura-ante-dgi.test.ts
 *
 * Mismo criterio que `emit-invoice-secuencia-de-escrituras`: acá no se verifica
 * el resultado, se verifica el ORDEN. Y el orden es todo lo que hay, porque la
 * decisión central de este módulo es una sola:
 *
 *   🔴 **PAC PRIMERO, LIBRO DESPUÉS** — y en el medio, `fe_estado = 'canceled'`
 *      ANTES de tocar el libro.
 *
 * Las dos cosas pueden fallar, así que la pregunta no es cómo evitarlo sino
 * cuál de los dos estados a medias preferimos. Libro primero deja una factura
 * anulada en nuestros libros y VIVA ante la DGI, con un asiento de reversión
 * que es inmutable por diseño y por lo tanto imposible de deshacer. PAC primero
 * deja una factura muerta ante la DGI y viva en el libro: se ve, se explica, y
 * se termina con un botón.
 *
 * Un refactor que invierta esos dos `await` no rompe ningún otro test y no
 * cambia ninguna firma. Rompe estos.
 *
 * Los cuatro caminos quedan escritos como listas literales, y arriba de ellos
 * las reglas que los recorren: **nadie escribe en la factura ni en el libro sin
 * una confirmación de la DGI**, y **el POST nunca sale sin que el intento esté
 * registrado**.
 */

import test, { mock, before } from "node:test";
import assert from "node:assert/strict";

const MOCKS_ENABLED = typeof mock.module === "function";
const skipNoMocks = MOCKS_ENABLED
  ? false
  : "requiere: npx tsx --test --experimental-test-module-mocks";

// Sandbox. `loadEmisorConfig` aborta si i_amb=1 fuera de producción.
Object.assign(process.env, {
  EFACTURA_EMISOR_RUC: "1234567",
  EFACTURA_EMISOR_DV: "12",
  EFACTURA_EMISOR_TIPO_CONTRIBUYENTE: "2",
  EFACTURA_EMISOR_RAZON_SOCIAL: "Integra Legal, S.A.",
  EFACTURA_EMISOR_SUCURSAL: "0000",
  EFACTURA_EMISOR_DIRECCION: "Calle 50",
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

const TENANT = "a0000000-0000-0000-0000-000000000001";
const USER = "b0000000-0000-0000-0000-000000000002";
const INVOICE = "c0000000-0000-0000-0000-000000000003";
const CUFE = "FE0120000015555555552020202609150000000010512345678901234567890";
const MOTIVO = "Datos del receptor incorrectos en el documento";

/** Emisión de hoy: la ventana de 182 h está abierta. */
const HOY = new Date("2026-09-23T12:00:00-05:00");
const EMISION = "2026-09-23";

type Row = Record<string, unknown>;

interface Escenario {
  /** Lo que devuelve el POST de anulación, o un Error para simular la caída. */
  respuestaDelPac: () => unknown;
  /** `null` = `cancelInvoice` anda; un Error = falla el libro. */
  fallaDelLibro: Error | null;
  invoice: Row;
  anulaciones: Array<Row & { id: string }>;
  diario: string[];
}

let escenario: Escenario;

function nuevoEscenario(over?: Partial<Escenario>): Escenario {
  return {
    respuestaDelPac: () => [{ codigo: "0260", mensaje: "Documento anulado" }],
    fallaDelLibro: null,
    invoice: {
      id: INVOICE,
      status: "emitida",
      fe_estado: "authorized",
      dgi_cufe: CUFE,
      issue_date: EMISION,
      dgi_fecha_autorizacion: "2026-09-23T09:00:00-05:00",
      credited_total: 0,
      amount_paid: 0,
    },
    anulaciones: [],
    diario: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Fake de Supabase que anota. El POST y el libro se anotan en el MISMO diario.
// ---------------------------------------------------------------------------

class FakeQuery {
  private op: "select" | "insert" | "update" = "select";
  private cols = "";
  private payload: Row = {};
  private filtros: Record<string, unknown> = {};

  constructor(private tabla: string) {}

  select(c: string): this {
    this.cols = c;
    return this;
  }
  insert(p: Row): this {
    this.op = "insert";
    this.payload = p;
    return this;
  }
  update(p: Row): this {
    this.op = "update";
    this.payload = p;
    return this;
  }
  eq(c: string, v: unknown): this {
    this.filtros[c] = v;
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
      .then(() => this.resolver())
      .then(onF, onR);
  }

  private resolver(): unknown {
    const e = escenario;

    if (this.tabla === "invoices" && this.op === "select") {
      e.diario.push("SELECT invoices (estado fiscal e interno)");
      return { data: e.invoice, error: null };
    }
    if (this.tabla === "accounting_periods" && this.op === "select") {
      e.diario.push("SELECT accounting_periods (¿mes cerrado?)");
      return { data: null, error: null };
    }
    if (this.tabla === "fe_anulaciones" && this.op === "select") {
      e.diario.push("SELECT fe_anulaciones (último intento)");
      const ult = e.anulaciones.at(-1);
      return { data: ult ? { intento: ult.intento } : null, error: null };
    }
    if (this.tabla === "fe_anulaciones" && this.op === "insert") {
      const cols = Object.keys(this.payload).sort().join(", ");
      e.diario.push(
        `INSERT fe_anulaciones {${cols}} resultado=${String(this.payload.resultado)} ← ANTES del POST`
      );
      const id = `anu-${e.anulaciones.length + 1}`;
      e.anulaciones.push({ id, ...this.payload });
      return { data: { id }, error: null };
    }
    if (this.tabla === "fe_anulaciones" && this.op === "update") {
      e.diario.push(`UPDATE fe_anulaciones resultado=${String(this.payload.resultado)}`);
      const fila = e.anulaciones.find((a) => a.id === this.filtros.id);
      if (fila) Object.assign(fila, this.payload);
      return { error: null };
    }
    if (this.tabla === "invoices" && this.op === "update") {
      const cols = Object.keys(this.payload).sort().join(", ");
      e.diario.push(`UPDATE invoices {${cols}} ← la marca, ANTES del libro`);
      Object.assign(e.invoice, this.payload);
      return { error: null };
    }
    throw new Error(`FakeQuery: caso no manejado ${this.tabla}/${this.op} cols=${this.cols}`);
  }
}

const db = {
  from(t: string) {
    return new FakeQuery(t);
  },
};

let anularFacturaAnteDgi: typeof import("@/lib/finanzas/efactura/orchestration/anular-factura-ante-dgi").anularFacturaAnteDgi;

before(async () => {
  if (!MOCKS_ENABLED) return;

  // `cancelInvoice` no se reimplementa: se observa. Su contenido ya lo cubren
  // los tests del Bloque 5 y la verificación SQL de la 052/053.
  mock.module("@/lib/finanzas/api/invoices", {
    namedExports: {
      cancelInvoice: async () => {
        escenario.diario.push("→ cancelInvoice (NC total + reversión + 'anulada')");
        if (escenario.fallaDelLibro) throw escenario.fallaDelLibro;
        escenario.invoice.status = "anulada";
        return {
          id: INVOICE,
          credit_note_id: "nc-1",
          credit_note_number: "NC-000001",
          reversal_entry_number: 77,
          reversed_entry_number: 12,
        };
      },
      periodoDeLaFacturaCerrado: async () => {
        escenario.diario.push("SELECT accounting_periods (¿mes cerrado?)");
        return false;
      },
    },
  });

  mock.module("@/lib/finanzas/efactura/transport/anulacion-en-pac", {
    namedExports: {
      anularEnPac: async () => {
        escenario.diario.push("POST /InvoiceEvents/CreateCancellation  ⟵ la DGI");
        const r = escenario.respuestaDelPac();
        if (r instanceof Error) throw r;
        return r;
      },
      consultarEstadoEnPac: async () => {
        escenario.diario.push("GET /Invoices/Authorization/{cufe}  ⟵ la DGI");
        return { cufe: CUFE, autorizada: true };
      },
      leerEstadoDelDocumento: (crudo: unknown) => ({
        cufe: CUFE,
        autorizada: true,
        anulado: null,
        anuladoSegunHipotesis: false,
        deletedDate: null,
        deletedBy: null,
        fechaAutorizacion: null,
        protocoloAutorizacion: null,
        crudo,
      }),
      MARCADOR_DE_ANULACION_CONFIRMADO: false,
    },
  });

  ({ anularFacturaAnteDgi } = await import(
    "@/lib/finanzas/efactura/orchestration/anular-factura-ante-dgi"
  ));
});

async function correr(over?: Partial<Escenario>) {
  escenario = nuevoEscenario(over);
  const r = await anularFacturaAnteDgi(
    db as never,
    db as never,
    TENANT,
    USER,
    INVOICE,
    MOTIVO,
    null,
    HOY
  );
  return { r, diario: escenario.diario, e: escenario };
}

/** Todo lo que pasa antes de saber qué contestó la DGI. */
const HASTA_EL_POST = [
  "SELECT invoices (estado fiscal e interno)",
  "SELECT accounting_periods (¿mes cerrado?)",
  "SELECT fe_anulaciones (último intento)",
  "INSERT fe_anulaciones {created_by, cufe, i_amb, intento, invoice_id, motivo, request_payload, resultado, tenant_id} resultado=sin_respuesta ← ANTES del POST",
  "POST /InvoiceEvents/CreateCancellation  ⟵ la DGI",
];

// ---------------------------------------------------------------------------
// LOS CUATRO CAMINOS
// ---------------------------------------------------------------------------

test("🔒 camino FELIZ: PAC, marca, libro — en ese orden", { skip: skipNoMocks }, async () => {
  const { r, diario, e } = await correr();

  assert.deepEqual(diario, [
    ...HASTA_EL_POST,
    "UPDATE fe_anulaciones resultado=anulada",
    // 🔴 La marca va ANTES del libro. Es lo único que convierte una caída en la
    //    línea siguiente en un estado recuperable en vez de una factura anulada
    //    ante la DGI sin una sola marca en nuestra base.
    "UPDATE invoices {fe_estado} ← la marca, ANTES del libro",
    "→ cancelInvoice (NC total + reversión + 'anulada')",
  ]);
  assert.equal(r.estado, "anulada");
  assert.equal(e.invoice.fe_estado, "canceled");
  assert.equal(e.invoice.status, "anulada");
});

test("🔒 camino LA DGI RECHAZA: no se toca nada", { skip: skipNoMocks }, async () => {
  const { r, diario, e } = await correr({
    respuestaDelPac: () => [{ codigo: "1801", mensaje: "No se pudo anular: fuera del plazo" }],
  });

  assert.deepEqual(diario, [...HASTA_EL_POST, "UPDATE fe_anulaciones resultado=rechazada"]);
  assert.equal(r.estado, "rechazada_por_la_dgi");
  if (r.estado !== "rechazada_por_la_dgi") return;
  assert.match(String(r.pista), /nota de cr[eé]dito/i, "el rechazo por plazo manda a la NC");
  assert.equal(e.invoice.fe_estado, "authorized", "la factura quedó igual");
  assert.equal(e.invoice.status, "emitida");
});

test("🔒 camino SE CORTÓ LA RED: no se toca nada", { skip: skipNoMocks }, async () => {
  const { r, diario, e } = await correr({
    respuestaDelPac: () => new Error("ECONNRESET"),
  });

  assert.deepEqual(diario, [...HASTA_EL_POST, "UPDATE fe_anulaciones resultado=sin_respuesta"]);
  assert.equal(r.estado, "no_sabemos");
  assert.match(r.mensaje, /NO se modificó/);
  assert.match(r.mensaje, /portal de la DGI/, "el mensaje dice qué verificar antes de reintentar");
  assert.equal(e.invoice.fe_estado, "authorized");
});

test(
  "🔒 camino RESPUESTA QUE NO ENTENDEMOS: consulta el estado y NO decide",
  { skip: skipNoMocks },
  async () => {
    // D3: antes de decidir nada se consulta el documento. Hoy esa consulta no
    // puede afirmar si está anulado, así que el caso escala a una persona — y
    // la respuesta de la consulta se guarda igual, porque es la evidencia que
    // la prueba de sandbox (b) necesita.
    const { r, diario, e } = await correr({ respuestaDelPac: () => [] });

    assert.deepEqual(diario, [
      ...HASTA_EL_POST,
      "GET /Invoices/Authorization/{cufe}  ⟵ la DGI",
      "UPDATE fe_anulaciones resultado=indeterminada",
    ]);
    assert.equal(r.estado, "no_sabemos");
    assert.equal(e.invoice.fe_estado, "authorized", "no se marcó nada");
    assert.equal(e.invoice.status, "emitida", "el libro no se tocó");

    const guardado = e.anulaciones[0].response_payload as Record<string, unknown>;
    assert.ok(
      "_consulta_de_estado" in guardado,
      "la respuesta de la consulta se guarda: es la evidencia de la prueba (b)"
    );
  }
);

test(
  "🔒 camino LA DGI ANULÓ PERO EL LIBRO FALLÓ: el estado intermedio de D4",
  { skip: skipNoMocks },
  async () => {
    const { r, diario, e } = await correr({
      fallaDelLibro: new Error("el período se cerró entre medio"),
    });

    assert.deepEqual(diario, [
      ...HASTA_EL_POST,
      "UPDATE fe_anulaciones resultado=anulada",
      "UPDATE invoices {fe_estado} ← la marca, ANTES del libro",
      "→ cancelInvoice (NC total + reversión + 'anulada')",
    ]);
    assert.equal(r.estado, "anulada_en_dgi_falta_el_libro");
    // 🔴 Acá está el punto de todo el archivo: la marca sobrevivió a la falla.
    assert.equal(e.invoice.fe_estado, "canceled", "muerta ante la DGI");
    assert.equal(e.invoice.status, "emitida", "viva en el libro");
    assert.match(r.mensaje, /Completar anulaci[oó]n/i, "la pantalla tiene qué ofrecer");
  }
);

test(
  "🔒 camino COMPLETAR desde el estado intermedio: NO vuelve a llamar al PAC",
  { skip: skipNoMocks },
  async () => {
    // Pedirle otra vez la anulación a un endpoint del que no sabemos si es
    // idempotente, sobre un documento que ya está anulado, sólo puede empeorar
    // las cosas.
    const { r, diario, e } = await correr({
      invoice: {
        id: INVOICE,
        status: "emitida",
        fe_estado: "canceled",
        dgi_cufe: CUFE,
        issue_date: EMISION,
        dgi_fecha_autorizacion: "2026-09-23T09:00:00-05:00",
        credited_total: 0,
        amount_paid: 0,
      },
    });

    assert.deepEqual(diario, [
      "SELECT invoices (estado fiscal e interno)",
      "SELECT accounting_periods (¿mes cerrado?)",
      "→ cancelInvoice (NC total + reversión + 'anulada')",
    ]);
    assert.equal(r.estado, "anulada");
    assert.equal(e.anulaciones.length, 0, "no se registró un intento nuevo");
    assert.equal(e.invoice.status, "anulada");
  }
);

test(
  "🔒 camino SIN CUFE: se anula sólo en el libro y NO se llama al PAC",
  { skip: skipNoMocks },
  async () => {
    // Es la celda "sin CUFE / mes abierto" de la matriz de D2, que dice textual
    // "es lo de hoy y no cambia". Si esta rama desapareciera, dejaría de poder
    // anularse una factura que hoy se anula sin problema — y eso sería una
    // decisión de política del bufete, no un efecto colateral de un refactor.
    const { r, diario, e } = await correr({
      invoice: {
        id: INVOICE,
        status: "emitida",
        fe_estado: "no_emitida",
        dgi_cufe: null,
        issue_date: EMISION,
        dgi_fecha_autorizacion: null,
        credited_total: 0,
        amount_paid: 0,
      },
    });

    assert.deepEqual(diario, [
      "SELECT invoices (estado fiscal e interno)",
      "SELECT accounting_periods (¿mes cerrado?)",
      "→ cancelInvoice (NC total + reversión + 'anulada')",
    ]);
    assert.equal(r.estado, "anulada");
    assert.equal(e.anulaciones.length, 0, "no hay intento que registrar: no hay a quién pedirle");
    assert.equal(e.invoice.status, "anulada");
  }
);

// ---------------------------------------------------------------------------
// LAS REGLAS QUE EL ORDEN SOSTIENE
// ---------------------------------------------------------------------------

const CAMINOS_QUE_LLAMAN_AL_PAC = [
  { nombre: "feliz", over: {} as Partial<Escenario> },
  {
    nombre: "rechazada",
    over: { respuestaDelPac: () => [{ codigo: "1801", mensaje: "No se pudo anular" }] },
  },
  { nombre: "red caída", over: { respuestaDelPac: () => new Error("ECONNRESET") } },
  { nombre: "indeterminada", over: { respuestaDelPac: () => [] } },
  { nombre: "libro falló", over: { fallaDelLibro: new Error("boom") } },
];

test(
  "🔴 el intento se REGISTRA antes de salir a la red, en todos los caminos",
  { skip: skipNoMocks },
  async () => {
    for (const c of CAMINOS_QUE_LLAMAN_AL_PAC) {
      const { diario } = await correr(c.over);
      const registro = diario.findIndex((l) => l.startsWith("INSERT fe_anulaciones"));
      const post = diario.findIndex((l) => l.startsWith("POST "));
      assert.ok(
        registro >= 0 && registro < post,
        `"${c.nombre}": se salió a la red sin registrar el intento. Si el proceso muere en ` +
          `la llamada, no queda rastro de que se pidió la anulación — y el que abra esa ` +
          `factura mañana no puede distinguir "nunca preguntamos" de "preguntamos y no sabemos".`
      );
    }
  }
);

test(
  "🔴 NADIE escribe en la factura ni en el libro sin confirmación de la DGI",
  { skip: skipNoMocks },
  async () => {
    for (const c of CAMINOS_QUE_LLAMAN_AL_PAC) {
      if (c.nombre === "feliz" || c.nombre === "libro falló") continue;
      const { diario, e } = await correr(c.over);
      assert.equal(
        diario.filter((l) => l.startsWith("UPDATE invoices")).length,
        0,
        `"${c.nombre}": se marcó la factura sin que la DGI confirmara la anulación`
      );
      assert.equal(
        diario.filter((l) => l.startsWith("→ cancelInvoice")).length,
        0,
        `"${c.nombre}": se revirtió el asiento sin que la DGI confirmara. Ese asiento es ` +
          `inmutable: no se puede deshacer.`
      );
      assert.equal(e.invoice.fe_estado, "authorized");
      assert.equal(e.invoice.status, "emitida");
    }
  }
);

test(
  "🔴 cuando la DGI confirma, la MARCA va antes del libro — siempre",
  { skip: skipNoMocks },
  async () => {
    for (const c of [{ nombre: "feliz", over: {} }, { nombre: "libro falló", over: { fallaDelLibro: new Error("boom") } }]) {
      const { diario } = await correr(c.over as Partial<Escenario>);
      const marca = diario.findIndex((l) => l.startsWith("UPDATE invoices"));
      const libro = diario.findIndex((l) => l.startsWith("→ cancelInvoice"));
      assert.ok(
        marca >= 0 && libro >= 0 && marca < libro,
        `"${c.nombre}": el libro se tocó antes de marcar la factura. Una caída entre las dos ` +
          `cosas dejaría un documento anulado ante la DGI sin una sola marca acá.`
      );
    }
  }
);

test("🔴 el POST sale UNA sola vez por invocación", { skip: skipNoMocks }, async () => {
  for (const c of CAMINOS_QUE_LLAMAN_AL_PAC) {
    const { diario } = await correr(c.over);
    assert.equal(
      diario.filter((l) => l.startsWith("POST ")).length,
      1,
      `"${c.nombre}": el endpoint de anulación se llamó más de una vez y no sabemos si es ` +
        `idempotente (prueba de sandbox (a)).`
    );
  }
});

// ---------------------------------------------------------------------------
// LOS GATES
// ---------------------------------------------------------------------------

test("un motivo corto rebota ANTES de llamar al PAC", { skip: skipNoMocks }, async () => {
  escenario = nuevoEscenario();
  await assert.rejects(
    () =>
      anularFacturaAnteDgi(db as never, db as never, TENANT, USER, INVOICE, "monto mal.", null, HOY),
    (err: unknown) => {
      assert.match(String((err as Error).message), /15 caracteres/);
      return true;
    }
  );
  assert.equal(
    escenario.diario.filter((l) => l.startsWith("POST ")).length,
    0,
    "no se llamó al PAC"
  );
});

test(
  "🔴 la matriz se vuelve a consultar acá: no se confía en la pantalla",
  { skip: skipNoMocks },
  async () => {
    // La factura ya tiene una NC en el libro. El botón pudo haberse renderizado
    // antes de eso; el servidor lo vuelve a mirar.
    escenario = nuevoEscenario({
      invoice: {
        id: INVOICE,
        status: "emitida",
        fe_estado: "authorized",
        dgi_cufe: CUFE,
        issue_date: EMISION,
        dgi_fecha_autorizacion: "2026-09-23T09:00:00-05:00",
        credited_total: 150,
        amount_paid: 0,
      },
    });
    await assert.rejects(
      () =>
        anularFacturaAnteDgi(db as never, db as never, TENANT, USER, INVOICE, MOTIVO, null, HOY),
      (err: unknown) => {
        assert.match(String((err as Error).message), /acreditados/);
        return true;
      }
    );
    assert.equal(escenario.diario.filter((l) => l.startsWith("POST ")).length, 0);
  }
);
