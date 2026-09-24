/**
 * 🔒 UNA FACTURA SE BLOQUEA POR SUS NOTAS DE CRÉDITO **VIGENTES**, NO POR SU HISTORIA.
 *
 *   npm test
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ ARREGLA LA 063
 * ─────────────────────────────────────────────────────────────────────────────
 * La `053` bloquea la anulación cuando la factura tiene una NC con asiento
 * propio en el libro, y la razón sigue valiendo: una NC parcial YA debitó su
 * parte del ingreso (D5), así que espejar el asiento original COMPLETO lo
 * contaría dos veces.
 *
 * Pero miraba la EXISTENCIA del asiento, y los asientos son inmutables. Una NC
 * **reversada** —cuyo débito ya fue cancelado por su propio espejo— seguía
 * bloqueando la factura para siempre. Quedaba sin salida: ni anular, ni volver
 * atrás.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LAS DOS MITADES DICEN LO MISMO POR CAMINOS DISTINTOS
 * ─────────────────────────────────────────────────────────────────────────────
 * · **El RPC** mira el ASIENTO y exige que NO esté reversado. Tiene que ser el
 *   asiento y no `credit_notes.status`, porque cuando el RPC corre ya existe la
 *   NC total de esa misma anulación, `emitida` y sin asiento: un filtro por
 *   status la haría bloquearse a sí misma. Lo verifica
 *   `sql/tests/verificacion-063-anular-con-nc-reversada.sql` con los tres casos
 *   sobre facturas reales.
 * · **La app y la matriz** miran `credited_total`, que es
 *   `SUM(grand_total) WHERE status = 'emitida'` desde la `051`: una NC anulada
 *   **sale de la cuenta sola**. Eso es lo que fija este archivo.
 *
 * O sea que del lado de TypeScript la 063 no cambió una línea — y justamente
 * por eso conviene un test que lo diga, para que nadie "arregle" el gate de la
 * app creyendo que le falta algo.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  decidirAccionFiscal,
  type EstadoDeFactura,
} from "../decidir-accion-fiscal";
import { MENSAJE_YA_ACREDITADA } from "@/lib/finanzas/api/invoices";

const BASE: EstadoDeFactura = {
  status: "emitida",
  feEstado: "authorized",
  dgiCufe: "FE0120000025046169-3-2021-40000020260924000000003900101201929835",
  issueDate: "2026-09-24",
  dgiFechaAutorizacion: "2026-09-24T10:00:00-05:00",
  creditedTotal: 0,
  amountPaid: 0,
  mesCerrado: false,
};

const AHORA = new Date("2026-09-24T12:00:00-05:00");
const factura = (p: Partial<EstadoDeFactura>): EstadoDeFactura => ({ ...BASE, ...p });

/**
 * `credited_total` es la derivada de la `051`: suma SÓLO las NC `emitida`. Los
 * tres casos del pedido se expresan en el único número que la app mira.
 */
const acreditado = {
  /** [A] una NC vigente de B/. 25. */
  unaVigente: 25,
  /** [B] su única NC, reversada ⇒ sale de la suma. */
  unicaReversada: 0,
  /** [C] una vigente de 25 y otra reversada (que ya no suma). */
  unaVigenteYUnaReversada: 25,
};

test("[A] factura con una NC VIGENTE: no se anula", () => {
  const r = decidirAccionFiscal(factura({ creditedTotal: acreditado.unaVigente }), AHORA);
  assert.equal(r.accion, "nc_04", "con NC vigente la corrección es otra NC, no la anulación");
  if (r.accion !== "nc_04") return;
  assert.ok(
    r.motivos.some((m) => m.includes("acreditados por nota de crédito")),
    `el motivo tiene que nombrar la nota de crédito: ${JSON.stringify(r.motivos)}`
  );
});

/**
 * 🔴 EL CASO QUE LA 063 DESTRABA.
 *
 * Antes, del lado de la base, esta factura quedaba bloqueada para siempre
 * aunque este número fuera 0, porque el RPC miraba el asiento y los asientos no
 * se borran.
 */
test("[B] factura con su ÚNICA NC REVERSADA: vuelve a la matriz normal", () => {
  const r = decidirAccionFiscal(factura({ creditedTotal: acreditado.unicaReversada }), AHORA);
  assert.equal(
    r.accion,
    "anular_en_dgi_y_libro",
    "sin NC vigentes, dentro de plazo y con el mes abierto, se anula como cualquier otra"
  );
});

test("[B'] y si está fuera de plazo, rebota por el PLAZO — no por la nota de crédito", () => {
  // Lo que importa del cambio es que la NC reversada deje de opinar. El resto
  // de la matriz sigue mandando igual que siempre.
  const fuera = new Date("2026-10-05T12:00:00-05:00");
  const r = decidirAccionFiscal(factura({ creditedTotal: 0 }), fuera);
  assert.equal(r.accion, "nc_04");
  if (r.accion !== "nc_04") return;
  assert.ok(
    r.motivos.every((m) => !m.includes("nota de crédito")),
    `ningún motivo puede nombrar la NC: ${JSON.stringify(r.motivos)}`
  );
  assert.ok(r.motivos.some((m) => m.includes("plazo")));
});

test("[C] una NC VIGENTE y otra REVERSADA: sigue bloqueada, por la vigente", () => {
  const r = decidirAccionFiscal(
    factura({ creditedTotal: acreditado.unaVigenteYUnaReversada }),
    AHORA
  );
  assert.equal(r.accion, "nc_04");
  if (r.accion !== "nc_04") return;
  assert.ok(r.motivos.some((m) => m.includes("acreditados por nota de crédito")));
  // Y el monto que se nombra es el de la VIGENTE, no la suma histórica.
  assert.ok(
    r.motivos.some((m) => m.includes("25.00")),
    `tiene que nombrar sólo lo vigente: ${JSON.stringify(r.motivos)}`
  );
});

test("el mensaje del gate de la app habla de lo acreditado, que ya excluye las anuladas", () => {
  assert.match(MENSAJE_YA_ACREDITADA(25), /25\.00/);
  assert.match(MENSAJE_YA_ACREDITADA(25), /otra nota de crédito/);
});
