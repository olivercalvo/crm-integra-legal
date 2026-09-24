/**
 * 🔒 LAS CUATRO PANTALLAS DEL BLOQUE 9C.
 *
 *   npm test
 *
 * Son cuatro cosas que un usuario aprieta y que tocan a la DGI o al libro, así
 * que lo que se fija acá es lo que no se puede ver leyendo el JSX de a una
 * línea: **quién ve cada botón**, **de dónde sale cada texto** y **qué no se
 * vuelve a derivar en la pantalla**.
 *
 * ⚠️ Esto NO reemplaza abrir la pantalla. La regla del proyecto sigue siendo
 * que un commit con pantalla se cierra con clics reales; este archivo atrapa
 * las regresiones que los clics de una sola vez no vuelven a atrapar.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../../../../..");
const leer = (rel: string) => readFileSync(path.resolve(RAIZ, rel), "utf8");

const NC_PAGE = "src/app/finanzas/notas-credito/[id]/page.tsx";
const ENVIAR = "src/app/finanzas/notas-credito/[id]/_components/enviar-nc-a-la-dgi-button.tsx";
const CUFE_CARD = "src/app/finanzas/facturas/_components/cufe-del-portal-card.tsx";
const FACTURA_PAGE = "src/app/finanzas/facturas/[id]/page.tsx";
const RUTA_EMIT = "src/app/api/finanzas/credit-notes/[id]/emit/route.ts";
const RUTA_REVERSE = "src/app/api/finanzas/credit-notes/[id]/reverse/route.ts";
const RUTA_CUFE = "src/app/api/finanzas/invoices/[id]/cufe/route.ts";

// ───────────────────────────────────────────────────────────────────────────
// (a) Emitir la NC a la DGI
// ───────────────────────────────────────────────────────────────────────────

test("(a) emitir la NC: admin y abogada en la pantalla Y en la ruta", () => {
  // Las dos mitades se mueven juntas o el permiso queda abierto de un lado.
  assert.match(leer(RUTA_EMIT), /\["admin", "abogada"\]\.includes\(ctx\.userRole\)/);
  assert.match(leer(NC_PAGE), /const puedeEnviarALaDgi =[\s\S]{0,40}puedeAccionar/);
});

test("(a) el botón sólo aparece mientras se pueda enviar", () => {
  const src = leer(NC_PAGE);
  // `authorized` y `pending` no se reenvían: el servidor responde 409 y la
  // pantalla no debe ofrecer un botón que va a fallar (⚠️ de CLAUDE.md: los
  // dos hacen falta, el 403/409 no reemplaza a esconder la acción).
  assert.match(src, /nc\.fe_estado === "no_emitida" \|\| nc\.fe_estado === "error"/);
});

test("(a) avisa ANTES de que sea irreversible, no después", () => {
  const src = leer(ENVIAR);
  assert.match(src, /ya no se puede corregir/);
  assert.match(src, /182 horas/, "el modal nombra el plazo de la anulación");
});

test("🔴 (a) el rechazo de la DGI se traduce, y el texto del PAC NO se tira", () => {
  const src = leer(ENVIAR);
  assert.match(src, /traducirCodigoDgi/, "usa el catálogo, no inventa el mensaje");
  assert.match(
    src,
    /Respuesta de la DGI: \{error\}/,
    "el texto crudo del PAC viaja igual: es lo único que sirve para hablar con ideati"
  );
});

test("🔴 (a) un rechazo del PAC NO se muestra como error del sistema", () => {
  // El envío OCURRIÓ y quedó en `fe_emisiones`. La ruta devuelve 200 con
  // `ok: false`; tratarlo como 5xx diría "no pasó nada", que es falso.
  const ruta = leer(RUTA_EMIT);
  assert.match(ruta, /el envío OCURRIÓ/i);
  assert.match(leer(ENVIAR), /if \(!json\.ok\)/);
});

// ───────────────────────────────────────────────────────────────────────────
// (b) y (d) El CUFE del portal, y el mensaje de "sin CUFE"
// ───────────────────────────────────────────────────────────────────────────

test("🔴 (d) el mensaje de «sin CUFE» está palabra por palabra como lo pidió el bufete", () => {
  const src = leer(CUFE_CARD);
  assert.match(
    src,
    /Esta factura no tiene CUFE\. Consulta con administración antes de hacer la nota de\s+crédito\./,
    "el texto es del bufete: no se reescribe ni se 'mejora'"
  );
});

test("(d) la tarjeta aparece exactamente cuando la matriz pide el CUFE", () => {
  const src = leer(FACTURA_PAGE);
  assert.match(src, /accionFiscal\.accion === "nc_04_requiere_cufe"/);
  assert.match(src, /<CufeDelPortalCard/);
});

test("(b) cargar el CUFE: admin y abogada; el contador NO", () => {
  // El dato sale del portal de facturación, no del libro: es la misma línea
  // que separa emitir de reversar en todo el módulo.
  assert.match(leer(RUTA_CUFE), /\["admin", "abogada"\]\.includes\(ctx\.userRole\)/);
  assert.match(leer(CUFE_CARD), /puedeCargar/);
  assert.match(leer(FACTURA_PAGE), /puedeCargar=\{canMutate\}/);
});

test("🔴 (b) la pantalla valida con el MISMO módulo que el servidor", () => {
  const src = leer(CUFE_CARD);
  assert.match(src, /import \{ validarCufe \} from "@\/lib\/finanzas\/validators\/cufe"/);
  // Y no reimplementa el formato por su cuenta: nada de regex del CUFE acá.
  assert.ok(
    !/FE\\d|\^FE|\{66\}/.test(src),
    "la tarjeta no debe tener su propia regla de formato del CUFE"
  );
});

test("(b) los avisos que NO bloquean se muestran, y no impiden guardar", () => {
  const src = leer(CUFE_CARD);
  assert.match(src, /revisado\?\.ok &&\s*\n?\s*revisado\.avisos\.map/);
  assert.match(src, /const puedeGuardar = revisado\?\.ok === true/);
});

test("⚠️ (b) la tarjeta dice que cargar el CUFE no lo verifica ante la DGI", () => {
  // ideati no tiene endpoint para consultar un documento ajeno (swagger
  // completo, 23/09/2026). Prometer lo contrario sería mentir.
  assert.match(leer(CUFE_CARD), /si está mal, se va a ver\s+como un rechazo/i);
});

// ───────────────────────────────────────────────────────────────────────────
// (c) Anular / reversar la NC
// ───────────────────────────────────────────────────────────────────────────

test("(c) reversar la NC: admin, abogada y contador en la pantalla Y en la ruta", () => {
  assert.match(leer(RUTA_REVERSE), /\["admin", "abogada", "contador"\]\.includes\(ctx\.userRole\)/);
  assert.match(leer(NC_PAGE), /\["admin", "abogada", "contador"\]\.includes\(userRole\)/);
});

test("🔴 (c) el plazo de 182 h lo decide la matriz, NO la pantalla", () => {
  const src = leer(NC_PAGE);
  assert.match(src, /decidirAccionSobreNotaDeCredito\(/);
  assert.doesNotMatch(
    src,
    /182|HORAS_PARA_ANULAR/,
    "el número no se repite acá: el mensaje de la matriz ya lo trae"
  );
});

test("(c) sin asiento propio no se ofrece reversar, y se explica por qué", () => {
  const src = leer(NC_PAGE);
  assert.match(src, /accion\.accion !== "sin_asiento_propio"/);
  assert.match(src, /accion\.accion === "sin_asiento_propio"/, "y el panel lo explica");
});

test("(c) el diálogo es el MISMO de los cobros, con su variante", () => {
  const src = leer(NC_PAGE);
  assert.match(src, /variante="nota_credito"/);
  assert.match(
    src,
    /import \{ ReversePaymentDialog \}/,
    "no hay un diálogo propio: la vista previa del espejo sale de una sola implementación"
  );
});
