/**
 * 🔒 E2 — EL NOMBRE DEL TERCERO EN EL MAYOR, TAMBIÉN PARA LO VIEJO.
 *
 *   npm test
 *
 * Josuarth (revisión del 28/09, punto 3): la columna Nombre dice el cliente o
 * proveedor de la transacción. Desde E2 los asientos nuevos lo guardan en la
 * línea de 100004/200001; los VIEJOS no se tocan (el libro es inmutable): se
 * resuelven desde su documento de origen, con la misma función que el Excel.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { nombreDelTercero, type LineaHermana } from "@/lib/finanzas/reports/libro-mayor";
import {
  nombresPorAsiento,
  origenesDeMovimientos,
  resolverTercerosFiscales,
} from "@/lib/finanzas/reports/tercero-fiscal";

const CONTROL = { "100004": "clientes", "200001": "proveedores" } as Record<string, string | null>;

function hermana(over: Partial<LineaHermana> = {}): LineaHermana {
  return { code: "100001", name: "Banco", debit: 10, credit: 0, line_order: 1, descripcion: null, ...over };
}

// ---------------------------------------------------------------------------
// 1. El orden de los escalones
// ---------------------------------------------------------------------------

test("2º escalón: el tercero del DOCUMENTO le pone nombre a la línea del banco de un asiento viejo", () => {
  // Un cobro de antes de E2: sin FK en ninguna línea, y 100004 con el nombre en texto.
  const banco = hermana();
  const control = hermana({ code: "100004", line_order: 2, descripcion: "texto viejo" });
  assert.equal(
    nombreDelTercero([banco, control], CONTROL, banco, "AURELIO BARRÍA QUINTERO"),
    "AURELIO BARRÍA QUINTERO",
    "el documento gana contra el texto de la línea de control"
  );
});

test("el tercero de la PROPIA línea sigue mandando sobre el del documento", () => {
  const propia = hermana({ code: "100004", terceroNombre: "EL DE LA LÍNEA" });
  assert.equal(nombreDelTercero([propia], CONTROL, propia, "EL DEL DOCUMENTO"), "EL DE LA LÍNEA");
});

test("🐞 3º escalón: sólo la línea de CUENTA CONTROL, o el único tercero del asiento", () => {
  // Hasta E2 tomaba el tercero de CUALQUIER hermana. Un asiento manual con dos
  // clientes distintos, en líneas que no son de control, no es de ninguno.
  const propia = hermana({ code: "600001" });
  const dos = [
    propia,
    hermana({ code: "400001", line_order: 2, terceroNombre: "CLIENTE A" }),
    hermana({ code: "400002", line_order: 3, terceroNombre: "CLIENTE B" }),
  ];
  assert.equal(nombreDelTercero(dos, CONTROL, propia), "", "dos terceros sin control: no se inventa");

  const conControl = [...dos, hermana({ code: "100004", line_order: 4, terceroNombre: "CLIENTE C" })];
  assert.equal(nombreDelTercero(conControl, CONTROL, propia), "CLIENTE C", "manda el de la cuenta control");

  const uno = [propia, hermana({ code: "400001", line_order: 2, terceroNombre: "ÚNICO" })];
  assert.equal(nombreDelTercero(uno, CONTROL, propia), "ÚNICO", "un solo tercero en el asiento: es ése");
});

test("🔴 E3: ya NO hay cuarto escalón: sin tercero la celda queda VACÍA, nunca el texto de la línea", () => {
  // Josuarth, 01/10/2026: el heurístico ponía "Cuentas por pagar" o
  // "Reversión" como si fueran un nombre (asientos 33, 34, 36 a 39 y 51).
  const propia = hermana();
  for (const texto of ["ESTACIÓN DELTA", "Cuentas por pagar", "Reversión: Cuentas por pagar"]) {
    const hermanas = [propia, hermana({ code: "100004", line_order: 2, descripcion: texto })];
    assert.equal(nombreDelTercero(hermanas, CONTROL, propia, null), "", texto);
  }
});

// ---------------------------------------------------------------------------
// 2. La resolución por documento, con una base simulada
// ---------------------------------------------------------------------------

type Fila = Record<string, unknown>;

/** Base de mentira: `from(tabla).select().eq().in()` devuelve las filas de esa tabla cuyo id esté en la lista. */
function baseSimulada(tablas: Record<string, Fila[]>) {
  const consultas: string[] = [];
  class Q {
    private ids: string[] | null = null;
    private tenant: string | null = null;
    constructor(private tabla: string) {}
    select() { return this; }
    eq(col: string, v: string) { if (col === "tenant_id") this.tenant = v; return this; }
    in(_col: string, ids: string[]) { this.ids = ids; return this; }
    then(res: (v: unknown) => void) {
      consultas.push(this.tabla);
      assert.equal(this.tenant, "T", `la consulta a ${this.tabla} filtra por tenant`);
      const filas = (tablas[this.tabla] ?? []).filter((f) => !this.ids || this.ids.includes(String(f.id)));
      return res({ data: filas, error: null });
    }
  }
  return { db: { from: (t: string) => new Q(t) }, consultas };
}

test("resuelve cobro (directo, también reversado), NC, gasto de trámite, pago a proveedor, NC de compra y reversiones", async () => {
  const { db } = baseSimulada({
    payments: [{ id: "pay1", client_id: "cli1" }],
    credit_notes: [{ id: "nc1", client_id: "cli1" }],
    expenses: [{ id: "gt1", supplier_id: "prv1" }],
    supplier_payments: [{ id: "sp1", compra: null, tramite: { supplier_id: "prv2" } }],
    supplier_credit_notes: [{ id: "ncp1", supplier_id: "prv2" }],
    clients: [{ id: "cli1", name: "AURELIO BARRÍA", ruc: "8-742-1183", digito_verificador: "01" }],
    suppliers: [
      { id: "prv1", legal_name: "MICROSISTEMAS, S.A.", ruc: "155-1-1", dv: "22" },
      { id: "prv2", legal_name: "CABLE ONDA S.A", ruc: "155-2-2", dv: "33" },
    ],
  });

  const movimientos = [
    { entry_id: "e1", source_type: "pago", source_id: "pay1" },
    // La reversión de ese cobro: source_type 'reversion', mismo source_id.
    { entry_id: "e2", source_type: "reversion", source_id: "pay1", reverses_source_type: "pago" },
    { entry_id: "e3", source_type: "nota_credito", source_id: "nc1" },
    { entry_id: "e4", source_type: "gasto_tramite", source_id: "gt1" },
    { entry_id: "e5", source_type: "pago_proveedor", source_id: "sp1" },
    { entry_id: "e6", source_type: "nota_credito_proveedor", source_id: "ncp1" },
    // Un manual: sin documento, no aparece.
    { entry_id: "e7", source_type: "manual", source_id: null },
  ];

  const terceros = await resolverTercerosFiscales(db as never, "T", origenesDeMovimientos(movimientos));
  const nombres = nombresPorAsiento(terceros);

  assert.equal(nombres.get("e1"), "AURELIO BARRÍA");
  assert.equal(nombres.get("e2"), "AURELIO BARRÍA", "la reversión del cobro tiene el mismo cliente");
  assert.equal(nombres.get("e3"), "AURELIO BARRÍA");
  assert.equal(nombres.get("e4"), "MICROSISTEMAS, S.A.");
  assert.equal(nombres.get("e5"), "CABLE ONDA S.A", "el pago de un gasto de trámite: el proveedor del gasto");
  assert.equal(nombres.get("e6"), "CABLE ONDA S.A");
  assert.equal(nombres.has("e7"), false);
  // 🔴 El RUC y el DV siguen separados.
  assert.deepEqual(terceros.get("e1"), { nombre: "AURELIO BARRÍA", ruc: "8-742-1183", dv: "01" });
});

test("una compra sin ficha de proveedor cae al nombre escrito (respaldo de la 033)", async () => {
  const { db } = baseSimulada({
    business_expenses: [{ id: "be1", supplier_id: null, supplier_name: "FERRETERÍA X" }],
  });
  const t = await resolverTercerosFiscales(db as never, "T", [
    { entry_id: "e1", source_type: "gasto", source_id: "be1" },
  ]);
  assert.deepEqual(t.get("e1"), { nombre: "FERRETERÍA X", ruc: "", dv: "" });
});
