/**
 * MONTO-INPUT — las tres transformaciones de un campo de dinero.
 *
 * Módulo PURO: sin React, sin DOM. Lo usa `components/ui/money-input.tsx`, que
 * es `"use client"`; el cálculo vive acá para que se pueda probar sin navegador
 * —el proyecto no tiene jsdom— y para no arrastrar la frontera de cliente a
 * quien sólo necesite formatear (ver `frontera-cliente-servidor.test.ts`).
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * EL VALOR QUE VIAJA ES CANÓNICO. EL SEPARADOR DE MILES ES SÓLO PINTURA
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 `onChange` emite SIEMPRE una cadena que `Number()` entiende: sin separador
 *    de miles, con punto decimal. Es obligatorio, no una preferencia de estilo:
 *    los formularios hacen `Number(l.amount)` sobre lo que reciben
 *    (`business-expense-form.tsx:160`, y lo mismo en facturas y cotizaciones).
 *    Un `"1,234.56"` guardado ahí se convierte en `NaN` y el total queda en cero
 *    **sin que nadie vea un error**.
 *
 * El `1,234.56` que se ve en pantalla lo produce `formatearMonto()` y existe
 * únicamente mientras el campo NO tiene el foco. Al enfocarlo se muestra el
 * canónico, así nadie edita una cadena con comas adentro.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA COMA SE INTERPRETA COMO EN `parseImporte()`, A PROPÓSITO
 * ─────────────────────────────────────────────────────────────────────────────
 * `contabilidad/asiento-manual.ts` ya decidió cómo se lee un importe tecleado a
 * mano: si conviven punto y coma, el ÚLTIMO manda; si viene sola, la coma es
 * decimal. Acá se repite ese criterio en vez de inventar uno nuevo. Dos reglas
 * distintas para el mismo teclado es cómo se llega a que la misma cadena valga
 * dos cosas según la pantalla.
 */

/** Cuántos decimales admite un importe. Dos, porque es dinero. */
const DECIMALES = 2;

/**
 * Limpia lo que se está tecleando, sin pelearse con quien escribe.
 *
 * Devuelve una cadena canónica PARCIAL: puede terminar en punto (`"100."`), que
 * es un estado legítimo a mitad de tipeo y que `Number()` igual resuelve.
 */
export function sanearMonto(raw: string, permitirNegativo = false): string {
  const crudo = raw ?? "";
  // Todo lo que no sea dígito, separador o signo se descarta en silencio: es lo
  // que pasa cuando alguien pega "B/. 1,234.56" desde un correo.
  let s = crudo.replace(/[^\d.,-]/g, "");

  const negativo = permitirNegativo && s.includes("-");
  s = s.replace(/-/g, "");

  // El punto de `B/.` sobrevive al filtro de arriba y queda pegado adelante:
  // `"B/. 1,234.56"` llega acá como `".1,234.56"` y, leído como decimal, se
  // convertía en `".12"`. Se descarta el separador inicial SÓLO si más adelante
  // queda otro, porque `".5"` tecleado a mano sí es medio balboa y tiene que
  // seguir siéndolo.
  if (/^[.,]/.test(s) && /[.,]/.test(s.slice(1))) s = s.replace(/^[.,]+/, "");

  const ultimaComa = s.lastIndexOf(",");
  const ultimoPunto = s.lastIndexOf(".");
  if (ultimaComa !== -1 && ultimoPunto !== -1) {
    // Conviven los dos: el que va más a la derecha es el decimal.
    if (ultimaComa > ultimoPunto) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (ultimaComa !== -1) {
    s = s.replace(/,/g, ".");
  }

  // Un solo separador decimal, y como mucho dos decimales.
  const i = s.indexOf(".");
  if (i !== -1) {
    s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, "").slice(0, DECIMALES);
  }

  return negativo && s !== "" ? "-" + s : s;
}

/**
 * Cierra el valor cuando el campo pierde el foco: `"100."` → `"100"`,
 * `".5"` → `"0.5"`. Sigue siendo canónico, sin separador de miles.
 *
 * Vacío se queda vacío. Un campo de dinero en blanco significa "no cargado", y
 * convertirlo en `"0"` haría que una línea intacta parezca cargada en cero.
 */
export function normalizarMonto(canonico: string): string {
  const s = (canonico ?? "").trim();
  if (s === "" || s === "-" || s === "." || s === "-.") return "";
  const n = Number(s);
  if (!Number.isFinite(n)) return "";
  return String(Math.round(n * 100) / 100);
}

/**
 * Lo que se ve cuando el campo NO está enfocado: dos decimales y separador de
 * miles. Nunca vuelve al formulario — es sólo lo que se pinta.
 *
 * Vacío devuelve vacío para que se vea el placeholder, no un "0.00" que haría
 * parecer cargado un campo que nadie tocó.
 */
export function formatearMonto(canonico: string): string {
  const s = (canonico ?? "").trim();
  if (s === "") return "";
  const n = Number(s);
  // Si no es un número, se muestra tal cual: tragarse el texto de alguien es
  // peor que mostrarlo raro.
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: DECIMALES,
    maximumFractionDigits: DECIMALES,
  });
}
