/**
 * 🔴 EL RUC Y EL DV NO SE CONCATENAN EN NINGÚN LADO.
 *
 * Josuarth fue explícito el 25/08/2026: los anexos de la declaración de renta
 * necesitan "el RUC en una columna y el DV en otra columna porque así está en el
 * formulario de la DGI". Guardarlos o mostrarlos juntos rompe exactamente el
 * trabajo para el que se pidió el módulo.
 *
 * Es una regla que un tipo de TypeScript no puede sostener: `ruc + dv` compila
 * perfecto. Así que se verifica leyendo el código, igual que `nav-guard.test.ts`
 * lee el JSX buscando enlaces rotos. Si alguien escribe la concatenación en seis
 * meses, esto falla y le explica por qué.
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const RAIZ = join(process.cwd(), "src");

/** Este archivo se excluye: nombra los patrones para poder prohibirlos. */
const ESTE_ARCHIVO = "ruc-dv-separados.test.ts";

/**
 * Las formas de juntarlos que un editor humano escribiría.
 *
 * Dos decisiones sobre el alcance, las dos aprendidas en la primera corrida:
 *
 * 1. **Solo código, no prosa.** Los comentarios y los nombres de test se
 *    saltean. La primera versión marcó cuatro líneas de
 *    `validate-client-fiscal-gate.test.ts` que decían "RUC+DV" describiendo un
 *    caso. Un test que grita por un comentario enseña a ignorarlo.
 *
 * 2. **Sensible a mayúsculas.** Se buscan los identificadores `ruc` y `dv` como
 *    los escribe el código, no "RUC" y "DV" como los escribe una persona.
 *
 * Y NO se busca cualquier aparición de los dos cerca: eso marcaría los
 * formularios y los tipos, que los nombran juntos porque van al lado en la
 * pantalla. Lo que se prohíbe es la OPERACIÓN de unirlos.
 */
const PATRONES: { re: RegExp; motivo: string }[] = [
  {
    re: /\bruc\b\s*\+\s*(?:[`'"][^`'"]*[`'"]\s*\+\s*)?\w*\.?\bdv\b/,
    motivo: "concatena ruc + dv con +",
  },
  {
    re: /\$\{[^}]*\bruc\b[^}]*\}[^`]{0,3}\$\{[^}]*\bdv\b[^}]*\}/,
    motivo: "concatena ruc y dv en un template string",
  },
  {
    re: /\[\s*\w*\.?\bruc\b\s*,\s*\w*\.?\bdv\b\s*\]\s*\.join/,
    motivo: "une ruc y dv con .join()",
  },
  {
    re: /\bruc\b\s*\.\s*concat\s*\(\s*\w*\.?\bdv\b/,
    motivo: "une ruc y dv con .concat()",
  },
];

/** ¿La línea es prosa? Ahí "RUC + DV" es una explicación, no una unión. */
function esProsa(linea: string): boolean {
  const t = linea.trim();
  if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return true;
  // Nombre de un test: describe un caso, no lo ejecuta.
  return /^\s*(test|it|describe)\s*\(/.test(t);
}

function archivosDeCodigo(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) {
      if (entrada === "node_modules" || entrada === ".next") continue;
      archivosDeCodigo(ruta, acc);
    } else if (/\.(ts|tsx)$/.test(entrada) && entrada !== ESTE_ARCHIVO) {
      acc.push(ruta);
    }
  }
  return acc;
}

test("ningún archivo del repo concatena el RUC con el DV", () => {
  const hallazgos: string[] = [];

  for (const archivo of archivosDeCodigo(RAIZ)) {
    const lineas = readFileSync(archivo, "utf8").split(/\r?\n/);
    const relativo = archivo.slice(process.cwd().length + 1).split(sep).join("/");

    lineas.forEach((linea, i) => {
      if (esProsa(linea)) return;
      for (const { re, motivo } of PATRONES) {
        if (re.test(linea)) {
          hallazgos.push(`   · ${relativo}:${i + 1} — ${motivo}\n     ${linea.trim()}`);
        }
      }
    });
  }

  assert.deepEqual(
    hallazgos,
    [],
    "\nEl RUC y el DV tienen que viajar SEPARADOS: así los pide el formulario de " +
      "la DGI y así se arman los anexos de la declaración de renta.\n" +
      "Si hacen falta juntos en pantalla, mostralos en dos elementos.\n\n" +
      hallazgos.join("\n") +
      "\n"
  );
});

test("el escáner detecta una concatenación de verdad", () => {
  // Sin esto, el test de arriba pasaría igual si los patrones estuvieran rotos.
  const ejemplos = [
    'const etiqueta = supplier.ruc + "-" + supplier.dv;',
    "const etiqueta = `${s.ruc}-${s.dv}`;",
    "const etiqueta = [s.ruc, s.dv].join('-');",
    'const etiqueta = ruc.concat(dv);',
  ];
  for (const linea of ejemplos) {
    assert.ok(
      PATRONES.some((p) => p.re.test(linea)),
      `el escáner NO detectó: ${linea}`
    );
  }
});

test("el escáner no marca prosa ni campos que solo van al lado", () => {
  const inocentes = [
    "  // Receptor 01 con RUC+DV pero SIN ubicación PASA (caso HERMANI).",
    '  test("receptor 01 con RUC+DV pero sin ubicación PASA", () => {',
    "  ruc: input.ruc,",
    "  dv: input.dv,",
    "  <Campo label=\"RUC\">{proveedor.ruc}</Campo>",
  ];
  for (const linea of inocentes) {
    const marcada = !esProsa(linea) && PATRONES.some((p) => p.re.test(linea));
    assert.ok(!marcada, `falso positivo en: ${linea}`);
  }
});

test("la migración 033 guarda ruc y dv en dos columnas distintas", () => {
  const sql = readFileSync(
    join(process.cwd(), "sql", "pending", "033_proveedores_entidad.sql"),
    "utf8"
  );
  assert.match(sql, /^\s*ruc\s+text,/m, "falta la columna ruc");
  assert.match(sql, /^\s*dv\s+text,/m, "falta la columna dv");
});
