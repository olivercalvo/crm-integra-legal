/**
 * Tests del validador de proveedores.
 *
 * El grueso de este archivo NO prueba que se rechace lo malo: prueba que NO se
 * rechace lo bueno. Josuarth avisó que el formato del RUC "complica o facilita
 * el trabajo al momento de hacer las declaraciones de renta", y un validador
 * estricto de más deja a alguien sin poder cargar un proveedor real.
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  validateCreateSupplier,
  avisosDeRuc,
} from "@/lib/finanzas/validators/supplier";
import {
  paymentTermsLabel,
  vencimientoPorPlazo,
  nombreDeProveedor,
} from "@/lib/finanzas/types/supplier";

function base(over: Record<string, unknown> = {}) {
  return { legal_name: "INMOBILIARIA COSTA DEL ESTE, S.A.", ...over };
}

// ---------------------------------------------------------------------------
// EL RUC: LO QUE LA DGI ACEPTA, SE ACEPTA
// ---------------------------------------------------------------------------

test("acepta todas las familias de RUC panameño que conocemos", () => {
  const reales = [
    "8-123-456", // cédula
    "3-101-1234",
    "10-15-99",
    "PE-8-123-456", // panameño en el extranjero
    "E-8-123-456", // extranjero
    "N-19-1234", // naturalizado
    "155123456-2-2015", // jurídica moderna
    "1234567-1-123456", // folio viejo
    "155-1234-5678 DV", // con texto suelto: se guarda igual
    "8 123 456", // con espacios
  ];

  for (const ruc of reales) {
    const r = validateCreateSupplier(base({ ruc }));
    assert.ok(r.ok, `RECHAZÓ un RUC legítimo: "${ruc}" → ${JSON.stringify(r.errors)}`);
    assert.equal(r.data?.ruc, ruc);
  }
});

test("del RUC solo se rechaza lo que no puede ser un RUC", () => {
  const largo = validateCreateSupplier(base({ ruc: "1".repeat(51) }));
  assert.ok(!largo.ok);
  assert.match(largo.errors!.ruc, /largo/i);

  const raro = validateCreateSupplier(base({ ruc: "155<script>@#$%" }));
  assert.ok(!raro.ok);
  assert.match(raro.errors!.ruc, /caracteres/i);
});

test("el RUC es opcional: se puede crear un proveedor sin tenerlo a mano", () => {
  const r = validateCreateSupplier(base());
  assert.ok(r.ok);
  assert.equal(r.data?.ruc, null);
  assert.equal(r.data?.dv, null);
});

// ---------------------------------------------------------------------------
// EL DV
// ---------------------------------------------------------------------------

test("el DV acepta 1 a 3 dígitos: un 5 sin el cero delante no se rechaza", () => {
  for (const dv of ["5", "05", "99", "100"]) {
    const r = validateCreateSupplier(base({ dv }));
    assert.ok(r.ok, `rechazó el DV "${dv}"`);
    assert.equal(r.data?.dv, dv);
  }
});

test("el DV no acepta letras: un dígito verificador es un número", () => {
  const r = validateCreateSupplier(base({ dv: "DV" }));
  assert.ok(!r.ok);
  assert.match(r.errors!.dv, /n[úu]mero/i);
});

// ---------------------------------------------------------------------------
// LOS AVISOS: ORIENTAN, NO BLOQUEAN
// ---------------------------------------------------------------------------

test("avisa cuando el RUC parece traer el DV pegado, pero deja guardar", () => {
  const avisos = avisosDeRuc("155123456-2-2015-05", "05");
  assert.ok(
    avisos.some((a) => a.includes("columnas") || a.includes("DV")),
    `esperaba un aviso sobre el DV pegado, hubo: ${JSON.stringify(avisos)}`
  );

  // Y sin embargo el validador lo acepta: es un aviso, no un error.
  const r = validateCreateSupplier(base({ ruc: "155123456-2-2015-05", dv: "05" }));
  assert.ok(r.ok, "un aviso NO puede impedir guardar");
});

test("avisa si falta el DV, porque los anexos de renta lo piden", () => {
  const avisos = avisosDeRuc("155123456-2-2015", null);
  assert.ok(avisos.some((a) => a.includes("DV")));
});

test("avisa si el DV no tiene dos dígitos, sin rechazarlo", () => {
  assert.ok(avisosDeRuc("8-123-456", "5").some((a) => a.includes("dos")));
  assert.equal(avisosDeRuc("8-123-456", "05").filter((a) => a.includes("dos")).length, 0);
});

test("sin RUC no hay avisos de RUC", () => {
  assert.deepEqual(avisosDeRuc(null, null), []);
});

// ---------------------------------------------------------------------------
// 🔴 RUC Y DV NUNCA SE JUNTAN
// ---------------------------------------------------------------------------

test("el validador devuelve RUC y DV como dos campos, jamás concatenados", () => {
  const r = validateCreateSupplier(base({ ruc: "155123456-2-2015", dv: "05" }));
  assert.ok(r.ok);
  assert.equal(r.data!.ruc, "155123456-2-2015");
  assert.equal(r.data!.dv, "05");
  // Lo que no debe pasar nunca: que el DV se haya colado dentro del RUC.
  assert.ok(!r.data!.ruc!.endsWith("05"), "el DV terminó dentro del RUC");
});

// ---------------------------------------------------------------------------
// TÉRMINOS DE PAGO
// ---------------------------------------------------------------------------

test("acepta los plazos que nombró Josuarth y también los que no", () => {
  for (const dias of [0, 30, 60, 90, 45, 7, 365]) {
    const r = validateCreateSupplier(base({ payment_terms_days: dias }));
    assert.ok(r.ok, `rechazó el plazo ${dias}`);
    assert.equal(r.data?.payment_terms_days, dias);
  }
});

test("sin plazo declarado, contado", () => {
  assert.equal(validateCreateSupplier(base()).data?.payment_terms_days, 0);
});

test("rechaza un plazo imposible", () => {
  assert.ok(!validateCreateSupplier(base({ payment_terms_days: -1 })).ok);
  assert.ok(!validateCreateSupplier(base({ payment_terms_days: 400 })).ok);
  assert.ok(!validateCreateSupplier(base({ payment_terms_days: 30.5 })).ok);
});

test("paymentTermsLabel dice Contado en cero y singulariza el día 1", () => {
  assert.equal(paymentTermsLabel(0), "Contado");
  assert.equal(paymentTermsLabel(1), "1 día");
  assert.equal(paymentTermsLabel(30), "30 días");
});

// ---------------------------------------------------------------------------
// EL PUNTO QUE CIERRA EL CÍRCULO: plazo → vencimiento → tramo
// ---------------------------------------------------------------------------

test("el vencimiento sale de la fecha del gasto más el plazo", () => {
  assert.equal(vencimientoPorPlazo("2026-02-01", 0), "2026-02-01", "contado vence el mismo día");
  assert.equal(vencimientoPorPlazo("2026-02-01", 30), "2026-03-03");
  assert.equal(vencimientoPorPlazo("2026-03-15", 60), "2026-05-14");
  assert.equal(vencimientoPorPlazo("2026-02-22", 15), "2026-03-09");
});

test("el vencimiento cruza fin de mes y año bisiesto sin corrimientos", () => {
  // 2026 no es bisiesto: febrero tiene 28.
  assert.equal(vencimientoPorPlazo("2026-01-31", 1), "2026-02-01");
  assert.equal(vencimientoPorPlazo("2026-12-20", 30), "2027-01-19");
  // 2028 sí es bisiesto.
  assert.equal(vencimientoPorPlazo("2028-02-28", 1), "2028-02-29");
});

test("una fecha inválida devuelve la original en vez de romper el reporte", () => {
  assert.equal(vencimientoPorPlazo("no-es-fecha", 30), "no-es-fecha");
});

// ---------------------------------------------------------------------------
// NOMBRE A MOSTRAR
// ---------------------------------------------------------------------------

test("se muestra la razón comercial cuando existe, y la social si no", () => {
  assert.equal(
    nombreDeProveedor({ legal_name: "COMERCIAL X, S.A.", trade_name: "Ferretería X" }),
    "Ferretería X"
  );
  assert.equal(
    nombreDeProveedor({ legal_name: "COMERCIAL X, S.A.", trade_name: "   " }),
    "COMERCIAL X, S.A."
  );
  assert.equal(
    nombreDeProveedor({ legal_name: "COMERCIAL X, S.A.", trade_name: null }),
    "COMERCIAL X, S.A."
  );
});

// ---------------------------------------------------------------------------
// LO OBLIGATORIO
// ---------------------------------------------------------------------------

test("la razón social es lo único obligatorio", () => {
  const sin = validateCreateSupplier({});
  assert.ok(!sin.ok);
  assert.ok(sin.errors!.legal_name);

  const soloNombre = validateCreateSupplier({ legal_name: "PROVEEDOR NUEVO" });
  assert.ok(soloNombre.ok, "con solo la razón social tiene que poder crearse");
});

test("los campos vacíos llegan como null, no como cadena vacía", () => {
  const r = validateCreateSupplier(
    base({ trade_name: "  ", ruc: "", dv: "  ", phone: "", email: "", notes: "  " })
  );
  assert.ok(r.ok);
  assert.equal(r.data!.trade_name, null);
  assert.equal(r.data!.ruc, null);
  assert.equal(r.data!.dv, null);
  assert.equal(r.data!.phone, null);
  assert.equal(r.data!.email, null);
  assert.equal(r.data!.notes, null);
});

test("un correo mal escrito se rechaza", () => {
  const r = validateCreateSupplier(base({ email: "esto-no-es-correo" }));
  assert.ok(!r.ok);
  assert.ok(r.errors!.email);
});
