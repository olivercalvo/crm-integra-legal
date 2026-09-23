/**
 * La matriz fiscal, probada fila por fila.
 *
 * Ejecución:
 *   npx tsx --test src/lib/finanzas/efactura/__tests__/decidir-accion-fiscal.test.ts
 *
 * Lo que estos tests cuidan no es la aritmética de las 182 horas —eso es una
 * resta— sino las tres decisiones que la función toma por nosotros y que son
 * fáciles de deshacer sin darse cuenta:
 *
 *   - que el plazo se cuente desde la EMISIÓN y no desde la autorización;
 *   - que "sin CUFE" NO se resuelva con una heurística por fecha;
 *   - que `'pending'` no se trate como "todavía no se mandó".
 *
 * Y una cuarta, que es de forma: la función no mira el reloj. `ahora` entra
 * siempre por parámetro. Hay un test que lo verifica corriéndola dos veces.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  decidirAccionFiscal,
  HORAS_PARA_ANULAR,
  DIAS_PARA_NC_SIN_OBSERVACION,
  type EstadoFiscalDeFactura,
} from "@/lib/finanzas/efactura/orchestration/decidir-accion-fiscal";

const CUFE = "FE0120000015555555552020202609150000000010512345678901234567890";

/** Emisión: 15/09/2026, 00:00 en Panamá (UTC-5) = 05:00Z. */
const EMISION = "2026-09-15";
const EMISION_MS = Date.parse("2026-09-15T00:00:00-05:00");

function enHoras(h: number): Date {
  return new Date(EMISION_MS + h * 3_600_000);
}

function autorizada(extra?: Partial<EstadoFiscalDeFactura>): EstadoFiscalDeFactura {
  return {
    feEstado: "authorized",
    dgiCufe: CUFE,
    issueDate: EMISION,
    dgiFechaAutorizacion: "2026-09-15T10:30:00-05:00",
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// LAS FILAS DE LA MATRIZ
// ---------------------------------------------------------------------------

test("autorizada y dentro del plazo → se anula ante la DGI", () => {
  const r = decidirAccionFiscal(autorizada(), enHoras(10));
  assert.equal(r.accion, "anular_en_dgi");
  if (r.accion !== "anular_en_dgi") return;
  assert.equal(r.cufe, CUFE);
  assert.equal(r.ventana.horasTranscurridas, 10);
  assert.equal(r.ventana.horasRestantes, 172);
  assert.equal(r.ventana.vencida, false);
  assert.match(r.mensaje, /172 horas/);
});

test("autorizada y vencido el plazo → nota de crédito 04 con el CUFE", () => {
  const r = decidirAccionFiscal(autorizada(), enHoras(200));
  assert.equal(r.accion, "nc_04");
  if (r.accion !== "nc_04") return;
  assert.equal(r.cufe, CUFE, "la 04 referencia el CUFE de la factura original");
  assert.equal(r.ventana.vencida, true);
  assert.equal(r.ventana.horasRestantes, 0, "no se informan horas negativas");
  assert.match(r.mensaje, /nota de crédito/i);
});

test("🔴 el borde: a las 182 horas EXACTAS todavía se anula; un minuto después, no", () => {
  const justo = decidirAccionFiscal(autorizada(), enHoras(HORAS_PARA_ANULAR));
  assert.equal(justo.accion, "anular_en_dgi", "182,0 h no es 'vencida'");

  const pasado = decidirAccionFiscal(
    autorizada(),
    new Date(EMISION_MS + HORAS_PARA_ANULAR * 3_600_000 + 60_000)
  );
  assert.equal(pasado.accion, "nc_04");
});

test("anulada ante la DGI → no queda nada que mandar", () => {
  const r = decidirAccionFiscal(autorizada({ feEstado: "canceled" }), enHoras(1));
  assert.equal(r.accion, "ya_anulada_en_dgi");
});

test("🔴 envío en curso ('pending') → esperar, nunca decidir", () => {
  // 'pending' NO es "todavía no se mandó": es "se mandó y no sabemos cómo
  // terminó". Si acá se devolviera una acción, se anularía un documento que
  // puede no existir — o se dejaría vivo uno que sí.
  const r = decidirAccionFiscal(
    { feEstado: "pending", dgiCufe: null, issueDate: EMISION, dgiFechaAutorizacion: null },
    enHoras(1)
  );
  assert.equal(r.accion, "esperar_confirmacion");
});

test("'pending' manda incluso si ya hay un CUFE guardado", () => {
  const r = decidirAccionFiscal(autorizada({ feEstado: "pending" }), enHoras(1));
  assert.equal(r.accion, "esperar_confirmacion", "el envío sin resolver gana sobre todo lo demás");
});

test("autorizada SIN CUFE → inconsistente, no se adivina", () => {
  const r = decidirAccionFiscal(autorizada({ dgiCufe: null }), enHoras(1));
  assert.equal(r.accion, "inconsistente");
});

// ---------------------------------------------------------------------------
// EL CASO DEL PORTAL: la razón de ser de `nc_04_requiere_cufe`
// ---------------------------------------------------------------------------

test("🔴 sin CUFE → PIDE el CUFE; no decide por su cuenta", () => {
  const r = decidirAccionFiscal(
    { feEstado: "no_emitida", dgiCufe: null, issueDate: "2026-05-20", dgiFechaAutorizacion: null },
    enHoras(1)
  );
  assert.equal(r.accion, "nc_04_requiere_cufe");
  assert.match(r.mensaje, /portal/i, "el mensaje nombra el camino que el CRM no registra");
});

test("🔴 una factura de ANTES del 8 de julio y una de DESPUÉS dan la MISMA respuesta", () => {
  // Las anteriores al 8 de julio de 2026 se emitieron a mano en el portal de
  // ideati (punto 050): tienen CUFE ante la DGI, pero el CRM no lo guardó. En
  // la base se ven idénticas a una que nunca se envió.
  //
  // Si algún día alguien "mejora" esto metiendo una fecha de corte, este test
  // falla. Esa es toda su función: una fecha hardcodeada decidiendo una acción
  // fiscal es un supuesto que en seis meses nadie recuerda que era un supuesto,
  // y el error no se ve — sale una nota de crédito genérica donde iba una 04
  // con referencia, y eso aparece en una auditoría, no en la pantalla.
  const vieja: EstadoFiscalDeFactura = {
    feEstado: "no_emitida",
    dgiCufe: null,
    issueDate: "2026-03-02",
    dgiFechaAutorizacion: null,
  };
  const nueva: EstadoFiscalDeFactura = { ...vieja, issueDate: "2026-09-20" };

  assert.equal(decidirAccionFiscal(vieja, enHoras(1)).accion, "nc_04_requiere_cufe");
  assert.equal(decidirAccionFiscal(nueva, enHoras(1)).accion, "nc_04_requiere_cufe");
});

test("un intento fallido ('error') tampoco tiene CUFE: mismo camino", () => {
  const r = decidirAccionFiscal(
    { feEstado: "error", dgiCufe: null, issueDate: EMISION, dgiFechaAutorizacion: null },
    enHoras(1)
  );
  assert.equal(r.accion, "nc_04_requiere_cufe");
});

test("si hay CUFE guardado, manda el CUFE aunque el estado sea 'error'", () => {
  // Un CUFE guardado sólo puede venir de una autorización: el documento existe
  // ante la DGI, sea cual sea el estado que quedó del lado del CRM.
  const r = decidirAccionFiscal(autorizada({ feEstado: "error" }), enHoras(3));
  assert.equal(r.accion, "anular_en_dgi");
});

// ---------------------------------------------------------------------------
// DESDE CUÁNDO SE CUENTAN LAS HORAS
// ---------------------------------------------------------------------------

test("🔴 el plazo se cuenta desde la EMISIÓN, no desde la autorización", () => {
  // Emitida el 15 a las 00:00; autorizada el 15 a las 22:00. A las 180 horas
  // de la emisión faltan 2 para vencer; contando desde la autorización
  // faltarían 24. Elegimos el que cierra antes: si la ventana real fuera más
  // larga, ofrecemos una NC donde se podía anular (inofensivo). Al revés
  // ofreceríamos un botón que la DGI rechaza.
  const estado = autorizada({ dgiFechaAutorizacion: "2026-09-15T22:00:00-05:00" });
  const r = decidirAccionFiscal(estado, enHoras(180));
  assert.equal(r.accion, "anular_en_dgi");
  if (r.accion !== "anular_en_dgi") return;
  assert.equal(r.ventana.contadaDesde, "emision");
  assert.equal(r.ventana.horasTranscurridas, 180);
  assert.equal(r.ventana.horasRestantes, 2);

  // Y a las 183 ya venció, aunque desde la autorización no hubieran pasado ni
  // 162 horas.
  assert.equal(decidirAccionFiscal(estado, enHoras(183)).accion, "nc_04");
});

test("la emisión se toma a las 00:00 de Panamá (UTC-5)", () => {
  const r = decidirAccionFiscal(autorizada(), enHoras(0));
  assert.equal(r.accion, "anular_en_dgi");
  if (r.accion !== "anular_en_dgi") return;
  assert.equal(r.ventana.desde, "2026-09-15T05:00:00.000Z", "00:00 en Panamá son las 05:00 UTC");
  assert.equal(r.ventana.horasTranscurridas, 0);
});

test("sin fecha de emisión cae a la de autorización antes de rendirse", () => {
  const r = decidirAccionFiscal(autorizada({ issueDate: null }), enHoras(12));
  assert.equal(r.accion, "anular_en_dgi");
  if (r.accion !== "anular_en_dgi") return;
  assert.equal(r.ventana.contadaDesde, "autorizacion");
});

test("sin ninguna fecha válida → inconsistente, no se inventa un punto de partida", () => {
  for (const issueDate of [null, "15/09/2026", "2026-13-99", "  "]) {
    const r = decidirAccionFiscal(
      autorizada({ issueDate, dgiFechaAutorizacion: null }),
      enHoras(1)
    );
    assert.equal(r.accion, "inconsistente", `issueDate=${JSON.stringify(issueDate)}`);
  }
});

test("un CUFE en blanco cuenta como ausente, no como presente", () => {
  const r = decidirAccionFiscal(
    { feEstado: "no_emitida", dgiCufe: "   ", issueDate: EMISION, dgiFechaAutorizacion: null },
    enHoras(1)
  );
  assert.equal(r.accion, "nc_04_requiere_cufe");
});

// ---------------------------------------------------------------------------
// EL PLAZO DE ITBMS: ADVIERTE, NO BLOQUEA
// ---------------------------------------------------------------------------

test("la NC a los 100 días trae advertencia, y sigue siendo una NC", () => {
  const r = decidirAccionFiscal(autorizada(), enHoras(100 * 24));
  assert.equal(r.accion, "nc_04", "el plazo de ITBMS no cambia la acción");
  if (r.accion !== "nc_04") return;
  assert.ok(r.advertencia, "debería advertir");
  assert.match(String(r.advertencia), new RegExp(String(DIAS_PARA_NC_SIN_OBSERVACION)));
});

test("la NC a los 30 días no trae advertencia", () => {
  const r = decidirAccionFiscal(autorizada(), enHoras(30 * 24));
  assert.equal(r.accion, "nc_04");
  if (r.accion !== "nc_04") return;
  assert.equal(r.advertencia, null);
});

// ---------------------------------------------------------------------------
// FORMA
// ---------------------------------------------------------------------------

test("🔴 la función no mira el reloj: mismo input, mismo output", () => {
  // Misma lección que el golden del payload. Una decisión fiscal que cambia
  // sola con el paso del tiempo no se puede probar ni reproducir en un reclamo.
  const estado = autorizada();
  const momento = enHoras(50);
  const a = JSON.stringify(decidirAccionFiscal(estado, momento));
  const b = JSON.stringify(decidirAccionFiscal(estado, momento));
  assert.equal(a, b);
});

test("no muta el estado que recibe", () => {
  const estado = autorizada();
  const copia = JSON.parse(JSON.stringify(estado));
  decidirAccionFiscal(estado, enHoras(5));
  assert.deepEqual(estado, copia);
});

test("toda acción trae un mensaje en claro para la pantalla", () => {
  // La pantalla de 9B tiene que poder mostrar esto sin volver a derivar la
  // matriz. Si el texto vive en el JSX, algún día el botón y el mensaje van a
  // discrepar — es la lección de `validarConsistenciaDeKind`.
  const casos: EstadoFiscalDeFactura[] = [
    autorizada(),
    autorizada({ feEstado: "canceled" }),
    autorizada({ feEstado: "pending" }),
    autorizada({ dgiCufe: null }),
    { feEstado: "no_emitida", dgiCufe: null, issueDate: EMISION, dgiFechaAutorizacion: null },
    { feEstado: "authorized", dgiCufe: CUFE, issueDate: null, dgiFechaAutorizacion: null },
  ];
  const vistas = new Set<string>();
  for (const c of casos) {
    for (const cuando of [enHoras(1), enHoras(500)]) {
      const r = decidirAccionFiscal(c, cuando);
      vistas.add(r.accion);
      assert.ok(r.mensaje.length > 20, `"${r.accion}" sin mensaje usable`);
    }
  }
  assert.equal(vistas.size, 6, `se ejercitaron ${vistas.size} de las 6 acciones: ${Array.from(vistas).join(", ")}`);
});
