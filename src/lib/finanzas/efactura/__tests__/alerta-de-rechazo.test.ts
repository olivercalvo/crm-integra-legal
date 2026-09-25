/**
 * La alerta de rechazo de la DGI: qué dice y por qué NO se borra al editar.
 *
 * Ejecución:  npm test
 *
 * El caso real que trajo todo esto: una factura rechazada con `1601`/`1602`, el
 * cliente corregido DESPUÉS del rechazo, y la factura **nunca reenviada**.
 * Quedó rechazada ante la DGI con los datos ya arreglados en el CRM, y nadie se
 * enteró porque nada en pantalla lo decía.
 *
 * O sea que hay dos cosas que probar, y la segunda es la que importa:
 *   1. que el aviso diga algo útil;
 *   2. 🔴 que **editar no lo haga desaparecer**.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  traducirCodigoDgi,
  traducirRechazo,
} from "@/lib/finanzas/efactura/mensajes-dgi";

const RAIZ = path.resolve(__dirname, "../../../../..");
const leer = (rel: string) => readFileSync(path.resolve(RAIZ, rel), "utf8");

// ---------------------------------------------------------------------------
// LA TRADUCCIÓN
// ---------------------------------------------------------------------------

test("🔴 el rechazo real 1601/1602 se traduce a algo accionable", () => {
  // "Regla de formación del RUC invalida" es correcto y no le sirve a nadie:
  // no dice de quién es el RUC ni en qué pantalla se arregla.
  const r = traducirRechazo(
    [
      { codigo: "1601", mensaje: "Regla de formación del RUC invalida" },
      { codigo: "1602", mensaje: "RUC inexistente en los registros de la DGI" },
    ],
    "CONSTRUCTORA CHIRIQUÍ ANTIGUO, S.A."
  );
  assert.equal(r.sinTraduccion, false);
  assert.match(r.resumen, /RUC del cliente/, "dice DE QUIÉN es el RUC");
  assert.match(String(r.queHacer), /CONSTRUCTORA/, "nombra al cliente: no hay que acordarse");
  assert.equal(r.donde, "ficha del cliente");
});

test("🔴 el texto del PAC NUNCA se tira: traducir no es reemplazar", () => {
  // Es lo único que sirve para hablar con ideati.
  const r = traducirRechazo([{ codigo: "1601", mensaje: "Regla de formación del RUC invalida" }]);
  assert.match(r.textoDelPac, /\[1601\]/);
  assert.match(r.textoDelPac, /Regla de formación/);
});

test("sin nombre de cliente, el mensaje sigue siendo correcto", () => {
  const r = traducirRechazo([{ codigo: "1602", mensaje: "x" }], null);
  assert.match(String(r.queHacer), /ficha del cliente/);
});

test("el 10105 manda a la factura y nombra el contador", () => {
  const r = traducirRechazo([{ codigo: "10105", mensaje: "Longitud excedida" }]);
  assert.equal(r.donde, "la factura");
  assert.match(String(r.queHacer), /contador/, "el campo ya tiene uno: se lo nombra");
});

test("🔴 el 1002 (duplicado) NO manda a reenviar", () => {
  // Reenviar un documento que puede estar autorizado es el peor consejo
  // posible: duplica ante la DGI o tapa el estado real.
  const r = traducirRechazo([{ codigo: "1002", mensaje: "Documento duplicado" }]);
  assert.match(String(r.queHacer), /No vuelva a enviarla/i);
  assert.equal(r.donde, "ningún lado");
});

test("🔴 un código DESCONOCIDO no se inventa una explicación", () => {
  // Misma regla que en los clasificadores, y por el mismo motivo: el `0600`
  // del endpoint de anulación era un ÉXITO y se leyó como rechazo porque no
  // estaba en una lista.
  const r = traducirRechazo([{ codigo: "9999", mensaje: "Algo que nadie vio antes" }]);
  assert.equal(r.sinTraduccion, true);
  assert.equal(r.queHacer, null, "no se inventa un 'qué hacer'");
  assert.match(r.textoDelPac, /9999/, "pero el texto crudo se muestra igual");
});

test("con varios códigos, alcanza que UNO se conozca", () => {
  const r = traducirRechazo([
    { codigo: "9999", mensaje: "desconocido" },
    { codigo: "1602", mensaje: "RUC inexistente" },
  ]);
  assert.equal(r.sinTraduccion, false);
  assert.match(r.textoDelPac, /9999/, "los dos se muestran crudos igual");
});

test("un rechazo sin códigos tampoco revienta", () => {
  const r = traducirRechazo([]);
  assert.equal(r.sinTraduccion, true);
  assert.match(r.textoDelPac, /no devolvió/);
});

test("traducirCodigoDgi devuelve null para lo que no está", () => {
  assert.equal(traducirCodigoDgi("0000"), null);
  assert.equal(traducirCodigoDgi(null), null);
  assert.equal(traducirCodigoDgi(""), null);
  assert.ok(traducirCodigoDgi("1601"));
});

// ---------------------------------------------------------------------------
// 🔴 LA ALERTA NO SE BORRA AL EDITAR
// ---------------------------------------------------------------------------

test("🔴 la alerta se lee de `fe_emisiones`, que es historia y nadie edita", () => {
  // Si se leyera de algo que la edición toca —un flag en la factura, un campo
  // del cliente— corregir el dato haría desaparecer el aviso, y la factura
  // quedaría rechazada ante la DGI sin nada que lo diga. Que es exactamente lo
  // que pasó.
  const src = leer("src/lib/finanzas/queries/fe-emisiones.ts");
  assert.match(src, /\.from\("fe_emisiones"\)/, "la fuente es el registro del intento");
  assert.doesNotMatch(
    src,
    /\.from\("clients"\)/,
    "no depende del cliente: editarlo no puede cambiar lo que la DGI contestó"
  );
});

test("🔴 el detalle sólo carga el rechazo cuando fe_estado === 'error'", () => {
  const src = leer("src/app/finanzas/facturas/[id]/page.tsx").replace(/\s+/g, " ");
  assert.ok(
    src.includes('invoice.fe_estado === "error" ? await ultimoEnvioFallido('),
    "el gate es el estado fiscal, no un flag aparte"
  );
});

test("🔴 GUARDAR UN CLIENTE NO TOCA `fe_estado` DE NINGUNA FACTURA", () => {
  // Es la mitad del caso real: el cliente se corrigió DESPUÉS del rechazo. Si
  // ese guardado hubiera limpiado el estado fiscal, el aviso se habría ido y la
  // factura habría quedado rechazada ante la DGI en silencio.
  for (const ruta of ["src/app/api/clients/route.ts", "src/app/api/clients/[id]/route.ts"]) {
    const src = leer(ruta);
    assert.doesNotMatch(
      src,
      /fe_estado/,
      `${ruta} menciona fe_estado: guardar un cliente no puede tocar el estado fiscal de una factura`
    );
  }
});

test("🔴 el aviso le DICE a la persona que corregir no lo borra", () => {
  // No alcanza con que sea verdad: hay que decirlo, o alguien va a corregir el
  // RUC, ver que el aviso sigue, y creer que el sistema no guardó el cambio.
  const src = leer("src/app/finanzas/facturas/_components/efactura-card.tsx");
  assert.match(src, /Corregir los datos no lo borra/);
  assert.match(src, /hasta que la factura se envíe otra vez/);
});

test("el botón dice REENVIAR, no 'reintentar'", () => {
  // "Reintentar" suena a que falló el sistema. Lo que falló fue el documento
  // ante la DGI, y lo que hay que hacer es mandarlo de nuevo ya corregido.
  // Desde el 25/09/2026 el texto vive en UN lugar (etiquetas-de-envio.ts) y el
  // diálogo lo toma de ahí: ver etiquetas-de-envio.test.ts.
  const src = leer("src/app/finanzas/facturas/_components/emit-efactura-dialog.tsx");
  const etiquetas = leer("src/lib/finanzas/efactura/etiquetas-de-envio.ts");
  assert.match(src, /etiquetaDeEnvio\(isRetry\)/);
  assert.match(etiquetas, /"Reenviar a la DGI"/);
  assert.doesNotMatch(src, /[Rr]eintentar env[ií]o/);
});

// ---------------------------------------------------------------------------
// EL CONTADOR DEL LISTADO
// ---------------------------------------------------------------------------

test("🔴 el contador se cuenta SIEMPRE, no sobre las filas filtradas", () => {
  // Es una alarma, no una columna del resultado: si dependiera de los filtros,
  // desaparecería justo cuando alguien está mirando otra cosa.
  const src = leer("src/lib/finanzas/queries/fe-emisiones.ts");
  assert.match(src, /contarFacturasConErrorDgi/);
  assert.match(src, /\.eq\("fe_estado", "error"\)/);
  assert.match(src, /head: true/, "cuenta sin traerse las filas");

  const pagina = leer("src/app/finanzas/facturas/page.tsx");
  assert.match(pagina, /contarFacturasConErrorDgi\(db, tenantId\)/);
  assert.doesNotMatch(
    pagina,
    /contarFacturasConErrorDgi\([^)]*status/,
    "el contador no recibe los filtros de la pantalla"
  );
});

test("el contador enlaza a un filtro que muestra esas facturas", () => {
  const pagina = leer("src/app/finanzas/facturas/page.tsx");
  assert.match(pagina, /\/finanzas\/facturas\?fe=error/);
  assert.match(pagina, /fe_estado: soloConErrorDgi \? "error" : null/);
});

test("singular y plural, que es lo que separa un sistema cuidado de uno que no", () => {
  const pagina = leer("src/app/finanzas/facturas/page.tsx");
  assert.match(pagina, /conErrorDgi === 1 \? "" : "s"/);
  assert.match(pagina, /conErrorDgi === 1 \? "la aceptó" : "las aceptó"/);
});

// ═══════════════════════════════════════════════════════════════════════════
// [1717] — el tope que lleva la DGI (Bloque 9C, 24/09/2026)
// ═══════════════════════════════════════════════════════════════════════════

test("[1717] se traduce, y manda a mirar las OTRAS notas de crédito", () => {
  const t = traducirCodigoDgi("1717");
  assert.ok(t, "1717 tiene que estar en el catálogo: es un rechazo real del sandbox");
  if (!t) return;
  // 🔴 El mensaje del PAC dice "inconsistentes con el monto", que suena a un
  //    error de tipeo en ESTA nota de crédito. Casi nunca es eso: es que la
  //    factura ya tiene otra. La traducción existe justamente para no mandar a
  //    revisar el campo equivocado.
  assert.match(t.queHacer, /notas de crédito que ya tiene la factura/);
  assert.equal(t.donde, "la factura");
  assert.ok(
    !/monto de esta/i.test(t.queHacer),
    "no debe mandar a revisar el monto que se acaba de escribir"
  );
});

test("[1717] avisa que una NC anulada ya no cuenta para la DGI", () => {
  // Está medido que la DGI libera el monto al anular (tope-de-la-dgi-congelado).
  // Si alguien ve este rechazo con la NC vieja ya anulada, el problema es otro
  // y conviene que la pantalla lo diga en vez de mandarlo a un callejón.
  const t = traducirCodigoDgi("1717");
  assert.ok(t);
  if (!t) return;
  assert.match(t.queHacer, /se anuló/);
});
