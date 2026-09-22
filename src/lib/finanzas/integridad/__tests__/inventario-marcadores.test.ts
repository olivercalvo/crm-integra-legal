/**
 * 🔴 NINGUNA MIGRACIÓN DE `sql/pending/` PUEDE QUEDARSE SIN MARCADOR.
 *
 * El 22/09/2026 se descubrió que a `docs/staging/inventario-migraciones.md` le
 * faltaban CATORCE filas (`025`–`033` y `040`–`044`). Ese documento decía ser la
 * fuente de verdad sobre qué migración está aplicada y cuál no, y por ese hueco
 * el análisis de despliegue arrancó la cola en la `034` cuando producción se
 * había detenido en la `024`. Nadie lo notó durante semanas porque un archivo
 * que falta en una tabla no se ve: solo se ve lo que está.
 *
 * La respuesta fue `scripts/inventario-migraciones.mjs`, que GENERA el
 * inventario leyendo el esquema. Pero el script tiene que saber QUÉ OBJETO busca
 * para cada migración —una tabla, una columna, una función, un índice, o un
 * SELECT cuando no deja rastro estructural— y eso se declara a mano en su mapa
 * `MARCADORES`, porque no se deduce del archivo: la `030` redefine funciones que
 * ya creó la `028`, la `053` es un `CREATE OR REPLACE` de la función de la `052`,
 * y la `026` es un INSERT que no deja rastro alguno.
 *
 * 🔒 Así que el mapa puede volver a quedarse corto, y este test es lo que lo
 *    impide. El script aborta con código 1 cuando lo corrés, pero **el script
 *    solo corre cuando alguien decide correrlo** — y el día que alguien agregue
 *    la `056` y no toque el inventario, nadie lo va a correr. `npm test` sí se
 *    corre.
 *
 * NO se conecta a ninguna base. Es una comparación entre un directorio y un mapa.
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const SCRIPT = join(RAIZ, "scripts", "inventario-migraciones.mjs");
const DIR_PENDING = join(RAIZ, "sql", "pending");

/**
 * Las claves del mapa se leen del TEXTO del script, no importándolo.
 *
 * Importar el `.mjs` desde un `.ts` obligaría a declararle tipos para que
 * `next build` no se queje, y ataría el test al módulo. Leerlo como texto es el
 * mismo enfoque de `ruc-dv-separados.test.ts` y `nav-guard.test.ts`, que leen
 * código buscando un patrón.
 *
 * El formato es estable porque es el de Prettier: dos espacios de indentación y
 * la clave entre comillas dobles, dentro de `const MARCADORES = {`.
 */
function clavesDeclaradas(): Set<string> {
  const fuente = readFileSync(SCRIPT, "utf8");

  const inicio = fuente.indexOf("const MARCADORES = {");
  assert.notEqual(
    inicio,
    -1,
    `No se encontró \`const MARCADORES = {\` en ${SCRIPT}. ` +
      "Si el mapa se renombró o se movió a otro archivo, actualizá este test " +
      "junto con el cambio — no lo borres."
  );

  const claves = new Set<string>();
  for (const m of fuente.slice(inicio).matchAll(/^ {2}"([^"]+\.sql)":/gm)) {
    claves.add(m[1]);
  }
  return claves;
}

function migracionesEnDisco(): string[] {
  return readdirSync(DIR_PENDING)
    .filter((f) => f.toLowerCase().endsWith(".sql"))
    .sort();
}

test("toda migración de sql/pending tiene una entrada en MARCADORES", () => {
  const declaradas = clavesDeclaradas();
  const enDisco = migracionesEnDisco();

  assert.ok(
    enDisco.length > 50,
    `Solo se leyeron ${enDisco.length} archivos de ${DIR_PENDING}. ` +
      "Algo anda mal con la ruta: el test no puede pasar por no encontrar nada."
  );

  const sinMarcador = enDisco.filter((f) => !declaradas.has(f));

  assert.deepEqual(
    sinMarcador,
    [],
    "\n\n" +
      "🔴 Estas migraciones de `sql/pending/` no tienen entrada en MARCADORES:\n\n" +
      sinMarcador.map((f) => `     · ${f}`).join("\n") +
      "\n\n" +
      "   Sin marcador desaparecen del inventario EN SILENCIO, que es\n" +
      "   exactamente lo que pasó el 22/09/2026 con catorce archivos.\n\n" +
      "   Agregá su entrada en `scripts/inventario-migraciones.mjs` diciendo qué\n" +
      "   objeto deja la migración: una tabla, una columna, una función, un\n" +
      "   índice, un constraint — o, si no deja ninguno, un marcador `dato` con\n" +
      "   el SELECT que lo resuelve.\n\n" +
      "   ⚠️ Un marcador `dato` solo puede nombrar tablas del esquema inicial:\n" +
      "   se inlinea en una consulta única de solo lectura, y una tabla que no\n" +
      "   existe la rompe entera en el parse.\n"
  );
});

test("no quedan entradas en MARCADORES cuyo archivo ya no existe", () => {
  const declaradas = clavesDeclaradas();
  const enDisco = new Set(migracionesEnDisco());

  // Las de `supabase/migrations/` también viven en el mismo mapa, así que se
  // descuentan antes de buscar huérfanas.
  const enSupabase = new Set(
    readdirSync(join(RAIZ, "supabase", "migrations")).filter((f) =>
      f.toLowerCase().endsWith(".sql")
    )
  );

  const huerfanas = [...declaradas].filter(
    (f) => !enDisco.has(f) && !enSupabase.has(f)
  );

  assert.deepEqual(
    huerfanas,
    [],
    "\n\n" +
      "Estas entradas de MARCADORES apuntan a archivos que ya no existen:\n\n" +
      huerfanas.map((f) => `     · ${f}`).join("\n") +
      "\n\n" +
      "   Borrarlas es seguro. Si el archivo se renombró, movele la entrada al\n" +
      "   nombre nuevo en vez de crear una nueva: el marcador ya estaba pensado.\n"
  );
});
