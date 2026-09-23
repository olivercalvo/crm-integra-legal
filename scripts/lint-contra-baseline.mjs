/**
 * ¿APARECIÓ ALGÚN ERROR DE LINT NUEVO?
 *
 *   node scripts/lint-contra-baseline.mjs
 *
 * `npm run lint` nunca estuvo en cero: hay 20 errores preexistentes en el
 * módulo Legal que Oliver decidió NO corregir (`docs/lint-baseline.md`). Con
 * eso, "lint verde" dejó de ser un criterio usable, y "contá si son más de 20"
 * es peor todavía — un error nuevo puede aparecer el mismo día que se arregla
 * uno viejo y el total no se mueve.
 *
 * Así que el criterio es **cero errores NUEVOS fuera de la lista**, y lo
 * verifica este script en vez de una persona.
 *
 * 🔴 COMPARA POR ARCHIVO + REGLA + SÍMBOLO, NO POR NÚMERO DE LÍNEA.
 *    Agregar una línea arriba de un error viejo lo corre de lugar, y una
 *    comparación por línea lo reportaría como nuevo. Ese falso positivo es
 *    exactamente lo que hace que la gente deje de mirar la salida.
 *
 * Un error de la lista que DESAPARECE no es un problema: se informa y se sigue.
 * Si se arreglan todos, se borra `docs/lint-baseline.md` y vuelve a valer
 * "lint verde".
 *
 * Sale con 1 sólo si hay errores nuevos.
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = resolve(RAIZ, "docs/lint-baseline.md");

/** `'ext' is assigned a value but never used.` → `ext` */
function simbolo(mensaje) {
  const m = mensaje.match(/'([^']+)'/);
  return m ? m[1] : mensaje.trim();
}

function clave(archivo, regla, sim) {
  return `${archivo.replace(/\\/g, "/")} :: ${regla} :: ${sim}`;
}

// ── La lista base, leída de la tabla del .md ────────────────────────────────
function leerBaseline() {
  if (!existsSync(BASELINE)) return null;
  const filas = new Set();
  for (const linea of readFileSync(BASELINE, "utf8").split("\n")) {
    // | `archivo` | `regla` | `símbolo` |
    const m = linea.match(/^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/);
    if (m) filas.add(clave(m[1], m[2], m[3]));
  }
  return filas;
}

// ── Lo que dice el lint ahora ───────────────────────────────────────────────
function correrLint() {
  let salida = "";
  try {
    salida = execSync("npx next lint", { cwd: RAIZ, encoding: "utf8", stdio: "pipe" });
  } catch (err) {
    // `next lint` sale con código != 0 cuando hay errores: la salida igual sirve.
    salida = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }

  const errores = [];
  let archivo = null;
  for (const cruda of salida.split("\n")) {
    const l = cruda.trimEnd();
    if (l.startsWith("./")) {
      archivo = l.slice(2).trim();
      continue;
    }
    const m = l.trim().match(/^(\d+):(\d+)\s+Error:\s+(.*?)\s{2,}([\w@/-]+)$/);
    if (m && archivo) {
      errores.push({
        archivo,
        linea: m[1],
        mensaje: m[3],
        regla: m[4],
        clave: clave(archivo, m[4], simbolo(m[3])),
      });
    }
  }
  return errores;
}

const base = leerBaseline();
const ahora = correrLint();

if (base === null) {
  if (ahora.length === 0) {
    console.log("✅ lint verde — no hay lista base y no hay errores.");
    process.exit(0);
  }
  console.error(`❌ ${ahora.length} errores de lint y no existe docs/lint-baseline.md.`);
  for (const e of ahora) console.error(`   ${e.archivo}:${e.linea}  [${e.regla}] ${e.mensaje}`);
  process.exit(1);
}

const nuevos = ahora.filter((e) => !base.has(e.clave));
const vistos = new Set(ahora.map((e) => e.clave));
const arreglados = [...base].filter((k) => !vistos.has(k));

console.log(`lista base: ${base.size}  ·  ahora: ${ahora.length}  ·  nuevos: ${nuevos.length}`);

if (arreglados.length > 0) {
  console.log(`\n🎉 ${arreglados.length} de la lista base ya no aparece(n):`);
  for (const k of arreglados) console.log(`   ${k}`);
  console.log("   (si se arreglaron todos, borrá docs/lint-baseline.md)");
}

if (nuevos.length === 0) {
  console.log(`\n✅ 0 errores nuevos. Siguen los ${ahora.length} de la lista base.`);
  process.exit(0);
}

console.error(`\n❌ ${nuevos.length} ERROR(ES) DE LINT NUEVO(S), fuera de la lista base:\n`);
for (const e of nuevos) {
  console.error(`   ${e.archivo}:${e.linea}  [${e.regla}] ${e.mensaje}`);
}
console.error(
  "\nArreglalos. La lista base es para la deuda vieja de Legal, no para sumarle deuda nueva."
);
process.exit(1);
