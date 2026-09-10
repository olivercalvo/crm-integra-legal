import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  formatearMonto,
  normalizarMonto,
  sanearMonto,
} from "@/lib/utils/monto-input";

/**
 * Lo que se prueba acá es la regla que sostiene todo el campo de dinero: lo que
 * viaja al formulario es canónico y lo que se ve es pintura. Si se rompe, los
 * totales se van a cero en silencio, que fue justamente el modo de falla que se
 * quiso evitar.
 */

describe("sanearMonto — lo que se teclea", () => {
  test("deja pasar lo normal", () => {
    assert.equal(sanearMonto("1234.56"), "1234.56");
    assert.equal(sanearMonto("100"), "100");
    assert.equal(sanearMonto(""), "");
  });

  test("conserva el punto a mitad de tipeo", () => {
    // `"100."` es un estado legítimo mientras alguien escribe `100.50`.
    assert.equal(sanearMonto("100."), "100.");
  });

  test("recorta a dos decimales", () => {
    assert.equal(sanearMonto("10.999"), "10.99");
  });

  test("un solo separador decimal", () => {
    assert.equal(sanearMonto("1.2.3"), "1.23");
  });

  test("descarta lo que no es número — el caso de pegar desde un correo", () => {
    assert.equal(sanearMonto("B/. 1,234.56"), "1234.56");
  });

  test("la coma sola es decimal, igual que en parseImporte()", () => {
    assert.equal(sanearMonto("100,50"), "100.50");
  });

  test("con punto y coma juntos, manda el de más a la derecha", () => {
    assert.equal(sanearMonto("1,234.56"), "1234.56");
    assert.equal(sanearMonto("1.234,56"), "1234.56");
  });

  test("el negativo sólo cuando está permitido", () => {
    assert.equal(sanearMonto("-50", false), "50");
    assert.equal(sanearMonto("-50", true), "-50");
  });
});

describe("normalizarMonto — al perder el foco", () => {
  test("cierra el tipeo a medias", () => {
    assert.equal(normalizarMonto("100."), "100");
    assert.equal(normalizarMonto(".5"), "0.5");
  });

  test("vacío se queda vacío: sin cargar NO es cero", () => {
    // Si devolviera "0", una línea que nadie tocó parecería cargada en cero y
    // dejaría de descartarse como intacta.
    assert.equal(normalizarMonto(""), "");
    assert.equal(normalizarMonto("-"), "");
  });
});

describe("formatearMonto — lo que se ve sin foco", () => {
  test("dos decimales y separador de miles", () => {
    assert.equal(formatearMonto("1234.5"), "1,234.50");
    assert.equal(formatearMonto("1234567.891"), "1,234,567.89");
    assert.equal(formatearMonto("0"), "0.00");
  });

  test("vacío no se pinta como 0.00", () => {
    assert.equal(formatearMonto(""), "");
  });
});

describe("🔴 el valor que viaja siempre lo entiende Number()", () => {
  test("nunca sale un separador de miles por onChange", () => {
    // Es LA garantía del componente: los formularios hacen Number() sobre esto
    // y un "1,234.56" daría NaN, con el total en cero y sin error visible.
    for (const tecleado of ["1,234.56", "1.234,56", "B/. 9,999.99", "1,000"]) {
      const canonico = sanearMonto(tecleado);
      assert.ok(
        !canonico.includes(","),
        `sanearMonto(${JSON.stringify(tecleado)}) devolvió ${JSON.stringify(canonico)}`
      );
      assert.ok(
        Number.isFinite(Number(canonico)),
        `Number(${JSON.stringify(canonico)}) no es finito`
      );
    }
  });

  test("ida y vuelta: se teclea, se muestra formateado, se vuelve a editar", () => {
    const canonico = normalizarMonto(sanearMonto("1,234.56"));
    assert.equal(canonico, "1234.56");
    assert.equal(formatearMonto(canonico), "1,234.56");
    // Y lo que se ve formateado, al reeditarlo, vuelve al mismo canónico.
    assert.equal(normalizarMonto(sanearMonto(formatearMonto(canonico))), canonico);
  });
});
