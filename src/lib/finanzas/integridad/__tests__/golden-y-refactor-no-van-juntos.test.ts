/**
 * 🔒 UN JSON DORADO Y EL REFACTOR QUE TENDRÍA QUE VERIFICAR NUNCA VAN EN EL
 *    MISMO COMMIT.
 *
 * Ejecución:
 *   npx tsx --test src/lib/finanzas/integridad/__tests__/golden-y-refactor-no-van-juntos.test.ts
 *
 * Un golden (`*-esperado.json`) sirve para una sola cosa: demostrar que un
 * cambio en el código NO alteró lo que sale. Sirve mientras siga siendo un
 * punto fijo. Si el mismo commit que toca el mapper regenera el JSON esperado,
 * el test pasa —se comparó contra sí mismo— y no probó absolutamente nada. Peor
 * todavía: queda el registro de un congelamiento que nunca ocurrió, y el
 * siguiente que lea la historia va a creer que ese camino está cubierto.
 *
 * El modo de fallar no es malicioso, es cómodo: se corre la suite, falla el
 * golden, y hay un comando a mano —`ACTUALIZAR_PAYLOAD=1 npm test`— que lo
 * "arregla" en dos segundos. Nadie decidió saltarse la verificación; sólo
 * siguió el camino que el error sugería. Por eso la regla necesita un test y no
 * un párrafo en un .md.
 *
 * ── CÓMO LO DETECTA ──────────────────────────────────────────────────────────
 *
 * Mira la historia de git: para cada golden, busca los commits que lo
 * MODIFICARON y revisa qué más venía en ese commit. Si viene código de
 * producción, falla y nombra el commit y los archivos.
 *
 * 🔴 SÓLO LAS MODIFICACIONES, NO EL ALTA. Un golden que NACE en un commit no
 * puede estar tapando nada: antes no existía, no había con qué comparar. Es la
 * modificación —la regeneración— la que borra la evidencia. La distinción no es
 * un atajo para que el test pase: es exactamente dónde está el riesgo.
 *
 * Qué SÍ puede acompañar a un golden modificado, sin que sea una alarma:
 *   · otros tests y otros goldens          (la red creciendo)
 *   · documentación (`.md`)                 (explicar por qué cambió)
 *   · scripts y SQL de verificación
 * Qué NO: cualquier archivo de `src/` que no sea un test. Eso es el refactor.
 *
 * ── SI ESTE TEST FALLA ───────────────────────────────────────────────────────
 *
 * El commit ya está hecho, así que no se "arregla" el test: se parte en dos.
 * Primero el commit que cambia el código con el golden VIEJO fallando —o con el
 * golden actualizado y el diff del JSON revisado línea por línea y explicado en
 * el mensaje—, y después el resto. Un commit que sólo toca un `-esperado.json`
 * es una alarma en sí mismo; uno que lo toca junto al código que verifica es la
 * alarma que este archivo levanta.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../../../../..");

/** Un golden es cualquier `*-esperado.json` dentro de un `__tests__`. */
const SUFIJO_GOLDEN = "-esperado.json";

/**
 * Lo que puede viajar junto a un golden modificado. Todo lo demás que esté bajo
 * `src/` se considera código de producción.
 */
function esAcompanianteLegitimo(archivo: string): boolean {
  const p = archivo.replace(/\\/g, "/");
  if (!p.startsWith("src/")) return true; // docs, sql, scripts, config del repo
  if (p.includes("/__tests__/")) return true;
  if (/\.test\.tsx?$/.test(p)) return true;
  return false;
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: RAIZ,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

function hayGit(): boolean {
  try {
    git(["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

function buscarGoldens(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    if (entrada === "node_modules" || entrada === ".next" || entrada === ".git") continue;
    const completo = path.join(dir, entrada);
    if (statSync(completo).isDirectory()) {
      buscarGoldens(completo, acc);
    } else if (entrada.endsWith(SUFIJO_GOLDEN)) {
      acc.push(path.relative(RAIZ, completo).replace(/\\/g, "/"));
    }
  }
  return acc;
}

const GOLDENS = buscarGoldens(path.join(RAIZ, "src"));

// ---------------------------------------------------------------------------

test("los goldens se descubren solos: no hay lista que se olvide de actualizar", () => {
  // Si mañana alguien agrega un `-esperado.json` nuevo, queda cubierto sin
  // tocar este archivo. Lo único que hay que verificar es que el barrido siga
  // encontrando algo: un descubrimiento vacío haría pasar todo lo de abajo.
  assert.ok(
    GOLDENS.length >= 2,
    `se esperaban al menos los dos goldens de eFactura; se encontraron ${GOLDENS.length}`
  );
  assert.ok(
    GOLDENS.some((g) => g.endsWith("payload-completo-esperado.json")),
    `no se encontró el golden del payload completo. Encontrados: ${GOLDENS.join(", ")}`
  );
});

test("🔴 ningún commit MODIFICA un golden junto con el código que ese golden verifica", (t) => {
  if (!hayGit()) {
    t.skip("sin repositorio git disponible: la historia no se puede revisar acá");
    return;
  }

  const violaciones: string[] = [];

  for (const golden of GOLDENS) {
    // --diff-filter=M: sólo modificaciones. El alta no tapa nada (ver el
    // encabezado). --follow para no perder el rastro si el archivo se mueve.
    const salida = git([
      "log",
      "--follow",
      "--diff-filter=M",
      "--format=%H",
      "--",
      golden,
    ]).trim();
    if (!salida) continue;

    for (const sha of salida.split("\n")) {
      const archivos = git(["show", "--name-only", "--format=", sha])
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      const codigo = archivos.filter((a) => !esAcompanianteLegitimo(a));
      if (codigo.length === 0) continue;

      const asunto = git(["log", "-1", "--format=%s", sha]).trim();
      violaciones.push(
        `  ${sha.slice(0, 7)} ${asunto}\n` +
          `    regeneró  ${golden}\n` +
          `    y además tocó código de producción:\n` +
          codigo.map((a) => `      · ${a}`).join("\n")
      );
    }
  }

  assert.equal(
    violaciones.length,
    0,
    "Un golden se regeneró en el mismo commit que el código que tenía que verificar.\n" +
      "El test pasó porque se comparó contra sí mismo: ese congelamiento no probó nada.\n\n" +
      violaciones.join("\n\n") +
      "\n\nNo se arregla este test: se parte el commit en dos. Primero el cambio de código\n" +
      "con el golden viejo —que debe fallar y mostrar el diff real—, después la\n" +
      "actualización del golden, explicada."
  );
});
