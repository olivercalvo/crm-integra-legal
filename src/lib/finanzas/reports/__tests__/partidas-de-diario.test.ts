import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  manualesSinTercero,
  partidasDeDiario,
  type LineaDeControl,
} from "@/lib/finanzas/reports/partidas-de-diario";
import { buildAntiguedad } from "@/lib/finanzas/reports/antiguedad";

const HOY = new Date("2026-10-01T12:00:00");

function linea(p: Partial<LineaDeControl>): LineaDeControl {
  return {
    entryId: "e1",
    entryNumber: 110,
    sourceType: "manual",
    fecha: "2026-09-01",
    referencia: "AD-000002",
    debit: 0,
    credit: 0,
    clientId: null,
    supplierId: null,
    terceroNombre: null,
    ...p,
  };
}

describe("partidasDeDiario (E9)", () => {
  it("una línea con cliente contra 100004 es una partida de ese cliente, por fecha de registro", () => {
    const [p] = partidasDeDiario(
      [linea({ debit: 150, clientId: "c1", terceroNombre: "Cliente Uno" })],
      "cobrar",
      new Set(),
      HOY
    );
    assert.deepEqual(p, {
      id: "e1:c1",
      numero: "AD-000002",
      tercero: "Cliente Uno",
      terceroId: "c1",
      fechaReferencia: "2026-09-01",
      diasVencido: 30,
      saldo: 150,
      sourceType: "manual",
      entryId: "e1",
    });
  });

  it("un crédito a 100004 resta (saldo a favor del cliente)", () => {
    const [p] = partidasDeDiario([linea({ credit: 40, clientId: "c1" })], "cobrar", new Set(), HOY);
    assert.equal(p.saldo, -40);
  });

  it("en pagar el crédito a 200001 suma", () => {
    const [p] = partidasDeDiario(
      [linea({ credit: 80, supplierId: "s1", terceroNombre: "Proveedor" })],
      "pagar",
      new Set(),
      HOY
    );
    assert.equal(p.saldo, 80);
    assert.equal(p.terceroId, "s1");
  });

  it("varias líneas del mismo asiento y tercero son UNA partida; si netean cero no se listan", () => {
    const r = partidasDeDiario(
      [
        linea({ debit: 100, clientId: "c1" }),
        linea({ debit: 25, clientId: "c1" }),
        linea({ debit: 30, clientId: "c2" }),
        linea({ credit: 30, clientId: "c2" }),
      ],
      "cobrar",
      new Set(),
      HOY
    );
    assert.equal(r.length, 1);
    assert.equal(r[0].saldo, 125);
  });

  it("un asiento reversado no entra (con su espejo suma cero en el mayor)", () => {
    const r = partidasDeDiario([linea({ debit: 100, clientId: "c1" })], "cobrar", new Set(["e1"]), HOY);
    assert.deepEqual(r, []);
  });

  it("la apertura se rotula, y sin referencia se usa el número del asiento", () => {
    const [p] = partidasDeDiario(
      [linea({ sourceType: "apertura", referencia: null, entryNumber: 1, debit: 10, clientId: "c1" })],
      "cobrar",
      new Set(),
      HOY
    );
    assert.equal(p.numero, "Asiento N.º 1 (apertura)");
  });

  it("en cobrar, una línea con PROVEEDOR no es partida del auxiliar de clientes", () => {
    assert.deepEqual(partidasDeDiario([linea({ debit: 10, supplierId: "s1" })], "cobrar", new Set(), HOY), []);
  });
});

describe("manualesSinTercero: una línea cuenta en la tabla o en la explicación, nunca en las dos", () => {
  const lineas = [
    linea({ entryId: "a", debit: 100, clientId: "c1" }), // partida
    linea({ entryId: "b", debit: 70 }), // vieja, sin tercero
    linea({ entryId: "c", debit: 5 }), // reversada
    linea({ entryId: "d", sourceType: "apertura", debit: 9 }), // apertura sin tercero: no es "manual"
  ];
  const reversados = new Set(["c"]);

  it("sólo cuenta las manuales sin tercero y no reversadas", () => {
    assert.deepEqual(manualesSinTercero(lineas, "cobrar", reversados), { cantidad: 1, monto: 70, terceros: [] });
  });

  it("el signo en pagar es el de siempre (el débito a 200001 baja el auxiliar)", () => {
    assert.equal(manualesSinTercero([linea({ debit: 20 })], "pagar", new Set()).monto, -20);
  });

  it("con la partida en la tabla, la diferencia contra el mayor sólo deja lo viejo y queda explicada", () => {
    const partidas = partidasDeDiario(lineas, "cobrar", reversados, HOY);
    const manuales = manualesSinTercero(lineas, "cobrar", reversados);
    // Mayor: factura 500 + las cuatro líneas manuales (el espejo de "c" resta 5).
    const mayor = 500 + 100 + 70 + 5 - 5 + 9;
    const reporte = buildAntiguedad(
      [
        {
          id: "f1",
          numero: "FAC-HON-000001",
          tercero: "Cliente Uno",
          terceroId: "c1",
          fechaReferencia: "2026-09-15",
          diasVencido: 16,
          saldo: 500,
          sourceType: "factura",
        },
        ...partidas,
      ],
      {
        saldoCuentaControl: mayor,
        saldoApertura: 9,
        cuentaCodigo: "100004",
        cuentaNombre: "Cuentas por cobrar",
        sinAsiento: {
          documentos: { cantidad: 0, monto: 0 },
          cobros: { cantidad: 0, monto: 0 },
          manuales,
        },
      }
    );
    const fila = reporte.filas.find((f) => f.terceroId === "c1")!;
    assert.equal(fila.total, 600);
    assert.equal(reporte.control.diferencia, 79);
    assert.equal(reporte.control.porCablearExplicado, true);
  });
});
