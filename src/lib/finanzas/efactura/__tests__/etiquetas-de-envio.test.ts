/**
 * 🔒 UN SOLO NOMBRE para mandar un documento a la DGI (25/09/2026):
 * «Enviar a la DGI» la primera vez y «Reenviar a la DGI» después de un rechazo,
 * en facturas y en notas de crédito. «Enviar al PAC» no vuelve.
 *
 *   npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { ENVIAR_A_LA_DGI, REENVIAR_A_LA_DGI, etiquetaDeEnvio } from "../etiquetas-de-envio";

const raiz = path.resolve(__dirname, "../../../../..");
const leer = (rel: string) => readFileSync(path.join(raiz, rel), "utf8");

test("primera vez y reintento", () => {
  assert.equal(etiquetaDeEnvio(false), "Enviar a la DGI");
  assert.equal(etiquetaDeEnvio(true), "Reenviar a la DGI");
  assert.equal(ENVIAR_A_LA_DGI, etiquetaDeEnvio(false));
  assert.equal(REENVIAR_A_LA_DGI, etiquetaDeEnvio(true));
});

test("🔒 la factura y la nota de crédito toman el nombre del mismo lugar", () => {
  const dialogoFactura = leer("src/app/finanzas/facturas/_components/emit-efactura-dialog.tsx");
  const tarjeta = leer("src/app/finanzas/facturas/_components/efactura-card.tsx");
  const botonNc = leer("src/app/finanzas/notas-credito/[id]/_components/enviar-nc-a-la-dgi-button.tsx");
  for (const [nombre, src] of [
    ["diálogo de la factura", dialogoFactura],
    ["tarjeta de la factura", tarjeta],
    ["botón de la NC", botonNc],
  ] as const) {
    assert.match(src, /from "@\/lib\/finanzas\/efactura\/etiquetas-de-envio"/, `${nombre}: importa las etiquetas`);
    assert.doesNotMatch(src, /"(Re)?[Ee]nviar a la DGI"/, `${nombre}: no escribe el texto a mano`);
    assert.doesNotMatch(src, /Reintentar (el )?envío/, `${nombre}: sin «Reintentar envío»`);
  }
});

test("🔒 ninguna pantalla dice «Enviar al PAC»", () => {
  const archivos: string[] = [];
  const recorrer = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) recorrer(p);
      else if (p.endsWith(".tsx")) archivos.push(p);
    }
  };
  recorrer(path.join(raiz, "src/app"));
  recorrer(path.join(raiz, "src/components"));
  const culpables = archivos.filter((p) => /enviar al PAC/i.test(readFileSync(p, "utf8")));
  assert.deepEqual(culpables.map((p) => path.relative(raiz, p)), []);
});
