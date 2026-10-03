/**
 * Validaciones previas a la DGI (03/10/2026): lo que el PAC rechazaría,
 * verificado antes de tomar número. Cada regla con su código de la ficha.
 *
 * Ejecución:  npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  validarParaLaDgi,
  resumirProblemas,
  erroresPorCampo,
  type DocumentoParaValidar,
} from "@/lib/finanzas/efactura/validaciones-previas";
import { esDeUnMesAnterior, MENSAJE_MES_ANTERIOR } from "@/lib/finanzas/efactura/orchestration/enviar-a-la-dgi";

const base = (over: Partial<DocumentoParaValidar> = {}): DocumentoParaValidar => ({
  clase: "factura",
  receptor: {
    name: "Ferretería Vallarino, S.A.",
    client_type: "persona_juridica",
    client_status: "active",
    tipo_receptor_fe: "01",
    tax_id: "1499876-1-690043",
    ruc: null,
    digito_verificador: "00",
    id_extranjero: null,
    pais_receptor: null,
  },
  lineas: [{ description: "Honorarios", quantity: 1, unit_price: 100, tax_rate: 0.07, subtotal: 100, tax_amount: 7 }],
  totales: { subtotal: 100, impuesto: 7, total: 107 },
  fechaDocumento: "2026-10-03",
  referencia: null,
  ...over,
});
const codigos = (d: DocumentoParaValidar) => validarParaLaDgi(d).map((p) => p.codigoDgi ?? p.campo);

test("un documento correcto no tiene problemas", () => {
  assert.deepEqual(validarParaLaDgi(base()), []);
});

test("RUC de persona jurídica: tres grupos numéricos; el del emisor y los de staging pasan", () => {
  for (const ruc of ["25046169-3-2021", "155123456-2-2015", "1499876-1-690043", "1711044-1-655190"]) {
    assert.deepEqual(validarParaLaDgi(base({ receptor: { ...base().receptor, tax_id: ruc } })), [], ruc);
  }
  for (const ruc of ["8-742-1183X", "ABC-1-2", "25046169-3", "25046169 3 2021 9"]) {
    assert.ok(codigos(base({ receptor: { ...base().receptor, tax_id: ruc } })).includes("1601"), ruc);
  }
});

test("RUC de persona natural: forma de cédula panameña (con sus prefijos)", () => {
  const nat = (ruc: string) => base({ receptor: { ...base().receptor, client_type: "persona_natural", tax_id: ruc } });
  for (const ruc of ["8-742-1183", "2-706-2214", "PE-12-345", "E-8-123456", "N-12-345", "8AV-12-345", "8NT-1-1234", "13-1-1"]) {
    assert.deepEqual(validarParaLaDgi(nat(ruc)), [], ruc);
  }
  for (const ruc of ["14-1-1", "8-742", "1499876-1-690043", "pasaporte123"]) {
    assert.ok(codigos(nat(ruc)).includes("1601"), ruc);
  }
});

test("DV obligatorio para contribuyente; falta el tipo de cliente; nombre de más de 100", () => {
  const r = base({ receptor: { ...base().receptor, digito_verificador: null, client_type: null, name: "x".repeat(101) } });
  const p = validarParaLaDgi(r);
  assert.ok(p.some((x) => x.campo === "digito_verificador"));
  assert.ok(p.some((x) => x.campo === "client_type"));
  assert.ok(p.some((x) => x.codigoDgi === "1605"));
});

test("consumidor final: no si es persona jurídica [1621], ni por más de B/. 10,000 [2515]", () => {
  const cf = { ...base().receptor, tipo_receptor_fe: "02" };
  assert.ok(codigos(base({ receptor: cf })).includes("1621"));
  const natural = { ...cf, client_type: "persona_natural", tax_id: null, digito_verificador: null };
  assert.deepEqual(validarParaLaDgi(base({ receptor: natural })), []);
  const grande = base({
    receptor: natural,
    lineas: [{ description: "Honorarios", quantity: 1, unit_price: 10000, tax_rate: 0.07, subtotal: 10000, tax_amount: 700 }],
    totales: { subtotal: 10000, impuesto: 700, total: 10700 },
  });
  assert.ok(codigos(grande).includes("2515"));
});

test("extranjero: identificación y país [1618, 1610]", () => {
  const ext = { ...base().receptor, tipo_receptor_fe: "04", tax_id: null, digito_verificador: null };
  const c = codigos(base({ receptor: ext }));
  assert.ok(c.includes("1618") && c.includes("1610"));
});

test("líneas: descripción vacía o de 501 [10105], cantidad 0, tasa que no es de la DGI; marca la línea", () => {
  const d = base({
    lineas: [
      { description: "  ", quantity: 1, unit_price: 50, tax_rate: 0.07, subtotal: 50, tax_amount: 3.5 },
      { description: "a".repeat(501), quantity: 0, unit_price: 50, tax_rate: 0.05, subtotal: 0, tax_amount: 0 },
    ],
    totales: { subtotal: 50, impuesto: 3.5, total: 53.5 },
  });
  const p = validarParaLaDgi(d);
  assert.ok(p.some((x) => x.linea === 1 && x.campo === "description"));
  assert.ok(p.some((x) => x.linea === 2 && x.codigoDgi === "10105"));
  assert.ok(p.some((x) => x.linea === 2 && x.campo === "quantity"));
  assert.ok(p.some((x) => x.linea === 2 && x.campo === "tax_code_id"));
  const e = erroresPorCampo(p);
  assert.ok(e["lines.0.description"] && e["lines.1.description"], "las claves que usa el formulario");
});

test("totales que no cuadran con las líneas [2500] y total mayor a un millón [2509]", () => {
  assert.ok(codigos(base({ totales: { subtotal: 99, impuesto: 7, total: 106 } })).includes("2500"));
  const millon = base({
    lineas: [{ description: "x", quantity: 1, unit_price: 1_000_001, tax_rate: 0, subtotal: 1_000_001, tax_amount: 0 }],
    totales: { subtotal: 1_000_001, impuesto: 0, total: 1_000_001 },
  });
  assert.ok(codigos(millon).includes("2509"));
});

test("nota referenciada: sin CUFE [1705] y a más de 180 días [1714]", () => {
  const nc = base({ clase: "nota_credito", referencia: { numero: "FAC-HON-000001", fecha: "2026-03-01", cufe: null } });
  const c = codigos(nc);
  assert.ok(c.includes("1705") && c.includes("1714"));
  const ok = base({ clase: "nota_credito", referencia: { numero: "FAC-HON-000001", fecha: "2026-09-01", cufe: "FE01…" } });
  assert.deepEqual(validarParaLaDgi(ok), []);
});

test("el resumen pone primero la ficha del cliente y no usa «—»", () => {
  const p = validarParaLaDgi(
    base({
      receptor: { ...base().receptor, digito_verificador: null },
      lineas: [{ description: "", quantity: 1, unit_price: 100, tax_rate: 0.07, subtotal: 100, tax_amount: 7 }],
    })
  );
  const texto = resumirProblemas(p);
  assert.match(texto.split("\n")[0], /^Ficha del cliente:/);
  assert.doesNotMatch(texto, /—/);
});

test("mes anterior: no se reenvía (consultar con el contador)", () => {
  assert.equal(esDeUnMesAnterior("2026-09-30", "2026-10-03"), true);
  assert.equal(esDeUnMesAnterior("2026-10-01", "2026-10-03"), false);
  assert.equal(esDeUnMesAnterior("2025-12-31", "2026-01-02"), true);
  assert.match(MENSAJE_MES_ANTERIOR, /^Consultar con el contador antes de reenviar/);
});

test("🔒 la ruta de emisión valida SIEMPRE la factura y la ND sólo si va a la DGI", () => {
  const ruta = readFileSync("src/app/api/finanzas/invoices/[id]/emit/route.ts", "utf8");
  assert.match(ruta, /\{ validarParaDgi: esNotaDeDebito \? envio === "dgi" : true \}/);
  const nc = readFileSync("src/app/api/finanzas/credit-notes/route.ts", "utf8");
  assert.match(nc, /\{ validarParaDgi: envio === "dgi" \}/);
});

test("🔒 ninguna ruta envía al PAC sin pasar por la puerta (mes anterior, validación, motivo)", () => {
  for (const f of ["src/app/api/finanzas/invoices/[id]/emit-efactura/route.ts", "src/app/api/finanzas/credit-notes/[id]/emit/route.ts", "src/lib/finanzas/efactura/orchestration/envio-al-emitir.ts"]) {
    const s = readFileSync(f, "utf8");
    assert.doesNotMatch(s, /emitInvoiceToEfactura\(|emitCreditNoteToEfactura\(/, f);
  }
});
