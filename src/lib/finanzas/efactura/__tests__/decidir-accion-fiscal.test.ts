/**
 * La matriz completa, probada celda por celda.
 *
 * Ejecución:
 *   npx tsx --test src/lib/finanzas/efactura/__tests__/decidir-accion-fiscal.test.ts
 *
 * Lo que estos tests cuidan no es la aritmética de las 182 horas —eso es una
 * resta— sino las decisiones que la función toma por nosotros y que son fáciles
 * de deshacer sin darse cuenta:
 *
 *   - que **gane siempre la regla más estricta**, sin que el orden de los `if`
 *     cambie la respuesta cuando dos reglas aplican a la vez (D2);
 *   - que el plazo se cuente desde la EMISIÓN y no desde la autorización;
 *   - que "sin CUFE" NO se resuelva con una heurística por fecha;
 *   - que `'pending'` no se trate como "todavía no se mandó";
 *   - que el estado intermedio —anulada en la DGI, viva en el libro— se
 *     responda ANTES que cualquier bloqueo (D4).
 *
 * Y una más, que es de forma: la función no mira el reloj. `ahora` entra
 * siempre por parámetro. Hay un test que lo verifica corriéndola dos veces.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  decidirAccionFiscal,
  HORAS_PARA_ANULAR,
  DIAS_PARA_NC_SIN_OBSERVACION,
  type EstadoDeFactura,
} from "@/lib/finanzas/efactura/orchestration/decidir-accion-fiscal";

const CUFE = "FE0120000015555555552020202609150000000010512345678901234567890";

/** Emisión: 15/09/2026, 00:00 en Panamá (UTC-5) = 05:00Z. */
const EMISION = "2026-09-15";
const EMISION_MS = Date.parse("2026-09-15T00:00:00-05:00");

function enHoras(h: number): Date {
  return new Date(EMISION_MS + h * 3_600_000);
}

/** Factura autorizada, sin cobros, sin NC, mes abierto. El caso limpio. */
function limpia(extra?: Partial<EstadoDeFactura>): EstadoDeFactura {
  return {
    status: "emitida",
    feEstado: "authorized",
    dgiCufe: CUFE,
    issueDate: EMISION,
    dgiFechaAutorizacion: "2026-09-15T10:30:00-05:00",
    creditedTotal: 0,
    amountPaid: 0,
    mesCerrado: false,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// LAS CELDAS DE LA MATRIZ (D2)
// ---------------------------------------------------------------------------

test("autorizada, dentro de plazo, mes abierto → anular en la DGI y en el libro", () => {
  const r = decidirAccionFiscal(limpia(), enHoras(10));
  assert.equal(r.accion, "anular_en_dgi_y_libro");
  if (r.accion !== "anular_en_dgi_y_libro") return;
  assert.equal(r.cufe, CUFE);
  assert.equal(r.ventana.horasTranscurridas, 10);
  assert.equal(r.ventana.horasRestantes, 172);
  assert.equal(r.ventana.vencida, false);
  assert.match(r.mensaje, /172 horas/);
});

test("🔴 < 182 h pero MES CERRADO → NC. Gana el mes cerrado", () => {
  // Regla del acta del 09/09: es contable, no fiscal. Anular reabriría un
  // período que el contador ya certificó, aunque la DGI todavía lo permitiera.
  const r = decidirAccionFiscal(limpia({ mesCerrado: true }), enHoras(10));
  assert.equal(r.accion, "nc_04");
  if (r.accion !== "nc_04") return;
  assert.deepEqual(r.motivos, ["el mes de la factura está cerrado"]);
  assert.equal(r.ventana.vencida, false, "la ventana seguía abierta: lo que bloqueó fue el mes");
});

test("🔴 ≥ 182 h con el mes ABIERTO → NC. Gana el plazo del PAC", () => {
  // El libro dejaría; la DGI no.
  const r = decidirAccionFiscal(limpia(), enHoras(200));
  assert.equal(r.accion, "nc_04");
  if (r.accion !== "nc_04") return;
  assert.equal(r.cufe, CUFE, "la 04 referencia el CUFE de la factura original");
  assert.equal(r.motivos.length, 1);
  assert.match(r.motivos[0], /182 horas/);
  assert.equal(r.ventana.horasRestantes, 0, "no se informan horas negativas");
});

test("🔴 ya tiene NC en el libro → no se anula nunca, ni dentro de plazo", () => {
  // Migración 053: la anulación espeja el asiento ORIGINAL completo y la NC
  // parcial ya debitó su parte. Se contabilizaría dos veces.
  const r = decidirAccionFiscal(limpia({ creditedTotal: 200 }), enHoras(1));
  assert.equal(r.accion, "nc_04");
  if (r.accion !== "nc_04") return;
  assert.equal(r.motivos.length, 1);
  assert.match(r.motivos[0], /200\.00 acreditados/);
});

test("🔴 los TRES motivos a la vez → se devuelven los tres, no el primero", () => {
  // Es el test de "gana siempre la más estricta". Si la implementación
  // devolviera el primer `if` que dispara, este test seguiría diciendo `nc_04`
  // pero con un solo motivo, y la pantalla mostraría una explicación incompleta
  // —la persona arregla lo que dice el mensaje, vuelve a intentar, y le falla
  // por lo segundo—. El orden de evaluación no puede cambiar la respuesta.
  const r = decidirAccionFiscal(
    limpia({ creditedTotal: 50, mesCerrado: true }),
    enHoras(500)
  );
  assert.equal(r.accion, "nc_04");
  if (r.accion !== "nc_04") return;
  assert.equal(r.motivos.length, 3, `motivos devueltos: ${JSON.stringify(r.motivos)}`);
  assert.match(r.mensaje, /acreditados/);
  assert.match(r.mensaje, /mes de la factura está cerrado/);
  assert.match(r.mensaje, /182 horas/);
});

test("🔴 el borde: a las 182 horas EXACTAS todavía se anula; un minuto después, no", () => {
  const justo = decidirAccionFiscal(limpia(), enHoras(HORAS_PARA_ANULAR));
  assert.equal(justo.accion, "anular_en_dgi_y_libro", "182,0 h no es 'vencida'");

  const pasado = decidirAccionFiscal(
    limpia(),
    new Date(EMISION_MS + HORAS_PARA_ANULAR * 3_600_000 + 60_000)
  );
  assert.equal(pasado.accion, "nc_04");
});

// ---------------------------------------------------------------------------
// EL ESTADO INTERMEDIO (D4)
// ---------------------------------------------------------------------------

test("🔴 anulada en la DGI pero viva en el libro → completar la anulación", () => {
  // Anular es PAC primero, libro después (D3). Entre las dos cosas hay una
  // ventana real. Esa combinación tiene nombre y acción de reintento.
  const r = decidirAccionFiscal(
    limpia({ feEstado: "canceled", status: "emitida" }),
    enHoras(3)
  );
  assert.equal(r.accion, "completar_anulacion_en_libro");
  if (r.accion !== "completar_anulacion_en_libro") return;
  assert.equal(r.cufe, CUFE);
  assert.match(r.mensaje, /no emita cobros ni notas de crédito/i);
});

test("🔴 el estado intermedio gana sobre TODOS los bloqueos", () => {
  // Una factura a medio anular hay que terminarla de anular aunque entre medio
  // se haya cerrado el mes, aparezca una NC, venza el plazo o entre un cobro.
  // Dejarla así es el único estado que después nadie puede explicar.
  const r = decidirAccionFiscal(
    limpia({
      feEstado: "canceled",
      status: "emitida",
      mesCerrado: true,
      creditedTotal: 999,
      amountPaid: 100,
    }),
    enHoras(5000)
  );
  assert.equal(r.accion, "completar_anulacion_en_libro");
});

test("anulada de los dos lados → no queda nada que hacer", () => {
  const r = decidirAccionFiscal(
    limpia({ feEstado: "canceled", status: "anulada" }),
    enHoras(1)
  );
  assert.equal(r.accion, "nada_que_hacer");
  assert.match(r.mensaje, /ante la DGI/);
});

test("anulada sólo en el libro (sin CUFE) → no queda nada que hacer, y el mensaje lo dice", () => {
  const r = decidirAccionFiscal(
    limpia({ feEstado: "no_emitida", dgiCufe: null, status: "anulada" }),
    enHoras(1)
  );
  assert.equal(r.accion, "nada_que_hacer");
  assert.doesNotMatch(r.mensaje, /ante la DGI/, "no se promete algo que no pasó");
});

// ---------------------------------------------------------------------------
// LO QUE NO ES LA MATRIZ PERO BLOQUEA IGUAL
// ---------------------------------------------------------------------------

test("borrador o cancelada antes de emitir → no aplica", () => {
  for (const status of ["borrador", "cancelada_pre_emision"]) {
    const r = decidirAccionFiscal(limpia({ status }), enHoras(1));
    assert.equal(r.accion, "no_aplica", status);
  }
});

test("🔴 envío en curso ('pending') → esperar, nunca decidir", () => {
  // 'pending' NO es "todavía no se mandó": es "se mandó y no sabemos cómo
  // terminó". Si acá se devolviera una acción, se anularía un documento que
  // puede no existir — o se dejaría vivo uno que sí.
  const r = decidirAccionFiscal(
    limpia({ feEstado: "pending", dgiCufe: null }),
    enHoras(1)
  );
  assert.equal(r.accion, "esperar_confirmacion");
});

test("'pending' manda incluso si ya hay un CUFE guardado", () => {
  const r = decidirAccionFiscal(limpia({ feEstado: "pending" }), enHoras(1));
  assert.equal(r.accion, "esperar_confirmacion");
});

test("con cobros aplicados → reversar los cobros primero", () => {
  // No está en la matriz de D2: es la regla que `cancelInvoice` ya aplicaba.
  // Viaja acá para que el diálogo no ofrezca un botón que el servidor rechaza.
  const r = decidirAccionFiscal(limpia({ amountPaid: 350.5 }), enHoras(1));
  assert.equal(r.accion, "reversar_cobros_primero");
  assert.match(r.mensaje, /350\.50/);
});

test("autorizada SIN CUFE → inconsistente, no se adivina", () => {
  const r = decidirAccionFiscal(limpia({ dgiCufe: null }), enHoras(1));
  assert.equal(r.accion, "inconsistente");
});

// ---------------------------------------------------------------------------
// EL CASO DEL PORTAL: la razón de ser de `nc_04_requiere_cufe`
// ---------------------------------------------------------------------------

test("🔴 sin CUFE → PIDE el CUFE; no decide por su cuenta", () => {
  const r = decidirAccionFiscal(
    limpia({ feEstado: "no_emitida", dgiCufe: null, issueDate: "2026-05-20" }),
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
  const vieja = limpia({ feEstado: "no_emitida", dgiCufe: null, issueDate: "2026-03-02" });
  const nueva = { ...vieja, issueDate: "2026-09-20" };

  assert.equal(decidirAccionFiscal(vieja, enHoras(1)).accion, "nc_04_requiere_cufe");
  assert.equal(decidirAccionFiscal(nueva, enHoras(1)).accion, "nc_04_requiere_cufe");
});

test("un intento fallido ('error') tampoco tiene CUFE: mismo camino", () => {
  const r = decidirAccionFiscal(limpia({ feEstado: "error", dgiCufe: null }), enHoras(1));
  assert.equal(r.accion, "nc_04_requiere_cufe");
});

test("sin CUFE y además con el mes cerrado → los motivos viajan igual", () => {
  const r = decidirAccionFiscal(
    limpia({ feEstado: "no_emitida", dgiCufe: null, mesCerrado: true }),
    enHoras(1)
  );
  assert.equal(r.accion, "nc_04_requiere_cufe");
  if (r.accion !== "nc_04_requiere_cufe") return;
  assert.deepEqual(r.motivos, ["el mes de la factura está cerrado"]);
});

test("si hay CUFE guardado, manda el CUFE aunque el estado sea 'error'", () => {
  // Un CUFE guardado sólo puede venir de una autorización: el documento existe
  // ante la DGI, sea cual sea el estado que quedó del lado del CRM.
  const r = decidirAccionFiscal(limpia({ feEstado: "error" }), enHoras(3));
  assert.equal(r.accion, "anular_en_dgi_y_libro");
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
  const estado = limpia({ dgiFechaAutorizacion: "2026-09-15T22:00:00-05:00" });
  const r = decidirAccionFiscal(estado, enHoras(180));
  assert.equal(r.accion, "anular_en_dgi_y_libro");
  if (r.accion !== "anular_en_dgi_y_libro") return;
  assert.equal(r.ventana.contadaDesde, "emision");
  assert.equal(r.ventana.horasTranscurridas, 180);
  assert.equal(r.ventana.horasRestantes, 2);

  // Y a las 183 ya venció, aunque desde la autorización no hubieran pasado ni
  // 162 horas.
  assert.equal(decidirAccionFiscal(estado, enHoras(183)).accion, "nc_04");
});

test("la emisión se toma a las 00:00 de Panamá (UTC-5)", () => {
  const r = decidirAccionFiscal(limpia(), enHoras(0));
  assert.equal(r.accion, "anular_en_dgi_y_libro");
  if (r.accion !== "anular_en_dgi_y_libro") return;
  assert.equal(r.ventana.desde, "2026-09-15T05:00:00.000Z", "00:00 en Panamá son las 05:00 UTC");
  assert.equal(r.ventana.horasTranscurridas, 0);
});

test("sin fecha de emisión cae a la de autorización antes de rendirse", () => {
  const r = decidirAccionFiscal(limpia({ issueDate: null }), enHoras(12));
  assert.equal(r.accion, "anular_en_dgi_y_libro");
  if (r.accion !== "anular_en_dgi_y_libro") return;
  assert.equal(r.ventana.contadaDesde, "autorizacion");
});

test("sin ninguna fecha válida → inconsistente, no se inventa un punto de partida", () => {
  for (const issueDate of [null, "15/09/2026", "2026-13-99", "  "]) {
    const r = decidirAccionFiscal(
      limpia({ issueDate, dgiFechaAutorizacion: null }),
      enHoras(1)
    );
    assert.equal(r.accion, "inconsistente", `issueDate=${JSON.stringify(issueDate)}`);
  }
});

test("un CUFE en blanco cuenta como ausente, no como presente", () => {
  const r = decidirAccionFiscal(
    limpia({ feEstado: "no_emitida", dgiCufe: "   " }),
    enHoras(1)
  );
  assert.equal(r.accion, "nc_04_requiere_cufe");
});

// ---------------------------------------------------------------------------
// EL PLAZO DE ITBMS: ADVIERTE, NO BLOQUEA
// ---------------------------------------------------------------------------

test("la NC a los 100 días trae advertencia, y sigue siendo una NC", () => {
  const r = decidirAccionFiscal(limpia(), enHoras(100 * 24));
  assert.equal(r.accion, "nc_04", "el plazo de ITBMS no cambia la acción");
  if (r.accion !== "nc_04") return;
  assert.ok(r.advertencia, "debería advertir");
  assert.match(String(r.advertencia), new RegExp(String(DIAS_PARA_NC_SIN_OBSERVACION)));
});

test("la NC a los 30 días no trae advertencia", () => {
  const r = decidirAccionFiscal(limpia({ mesCerrado: true }), enHoras(30 * 24));
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
  const estado = limpia();
  const momento = enHoras(50);
  const a = JSON.stringify(decidirAccionFiscal(estado, momento));
  const b = JSON.stringify(decidirAccionFiscal(estado, momento));
  assert.equal(a, b);
});

test("no muta el estado que recibe", () => {
  const estado = limpia();
  const copia = JSON.parse(JSON.stringify(estado));
  decidirAccionFiscal(estado, enHoras(5));
  assert.deepEqual(estado, copia);
});

test("las NUEVE acciones se pueden alcanzar, y todas traen mensaje para la pantalla", () => {
  // La pantalla de 9B/5 tiene que poder mostrar esto sin volver a derivar la
  // matriz. Si el texto vive en el JSX, algún día el botón y el mensaje van a
  // discrepar — es la lección de `validarConsistenciaDeKind`.
  const casos: Array<[string, EstadoDeFactura, Date]> = [
    ["anular_en_dgi_y_libro", limpia(), enHoras(1)],
    ["nc_04", limpia(), enHoras(500)],
    ["nc_04_requiere_cufe", limpia({ feEstado: "no_emitida", dgiCufe: null }), enHoras(1)],
    ["completar_anulacion_en_libro", limpia({ feEstado: "canceled" }), enHoras(1)],
    ["reversar_cobros_primero", limpia({ amountPaid: 10 }), enHoras(1)],
    ["esperar_confirmacion", limpia({ feEstado: "pending" }), enHoras(1)],
    ["nada_que_hacer", limpia({ status: "anulada", feEstado: "canceled" }), enHoras(1)],
    ["no_aplica", limpia({ status: "borrador" }), enHoras(1)],
    ["inconsistente", limpia({ dgiCufe: null }), enHoras(1)],
  ];

  const vistas = new Set<string>();
  for (const [esperada, estado, cuando] of casos) {
    const r = decidirAccionFiscal(estado, cuando);
    assert.equal(r.accion, esperada, `se esperaba "${esperada}" y salió "${r.accion}"`);
    assert.ok(r.mensaje.length > 20, `"${r.accion}" sin mensaje usable`);
    vistas.add(r.accion);
  }
  assert.equal(vistas.size, 9, `acciones alcanzadas: ${Array.from(vistas).join(", ")}`);
});
