/**
 * 🔴 UN SERVER COMPONENT NO PUEDE IMPORTAR UNA FUNCIÓN DE UN MÓDULO `"use client"`.
 *
 * El 09/09/2026, en la reunión con RM, tres pantallas de reportes devolvieron
 * «Application error: a server-side exception has occurred» al aplicar un filtro
 * de fechas. La causa: `fechaLarga()` vivía en `periodo-filtros.tsx`, que es
 * `"use client"`, y los Server Components de pyl, balance y comprobación la
 * importaban de ahí.
 *
 * Cuando un Server Component importa de un módulo cliente NO recibe la función:
 * recibe la referencia de cliente que React usa para hidratar. Llamarla lanza
 * `TypeError: … is not a function`.
 *
 * ⚠️ NADA lo detecta antes de producción: TypeScript compila, `next build` pasa
 * y la pantalla anda mientras no se ejecute la línea que llama a la función. Acá
 * eso significaba «anda sin filtro, revienta con filtro».
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA REGLA QUE SE VERIFICA
 * ─────────────────────────────────────────────────────────────────────────────
 * Un módulo `"use client"` sólo puede exportar COMPONENTES hacia un módulo de
 * servidor. Pasar un componente cliente a través de la frontera es justamente
 * para lo que sirve; pasar una función común, no.
 *
 * La distinción se hace por el nombre, que en este repo es una convención
 * escrita (`claude.md` §10: «Nombres de componentes en PascalCase»). Entonces:
 *
 *   ✅ `export function PeriodoFiltros()`  — componente, cruza la frontera
 *   ❌ `export function fechaLarga()`      — función común, NO cruza
 *   ❌ `export const TROZO = 3180`         — constante, NO cruza
 *
 * El arreglo cuando esto falla NO es renombrar la función: es MOVERLA a un
 * módulo sin `"use client"`, que los dos lados pueden importar. Ver
 * `src/lib/finanzas/reports/fecha-larga.ts`, que es el que se creó ese día.
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname, sep } from "node:path";

const RAIZ = join(process.cwd(), "src");

/** Extensiones que Next resuelve cuando un import no las nombra. */
const EXTENSIONES = [".ts", ".tsx", ".js", ".jsx"];

function recorrer(dir: string, salida: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const p = join(dir, entrada);
    if (statSync(p).isDirectory()) {
      if (entrada === "node_modules" || entrada === "__tests__") continue;
      recorrer(p, salida);
    } else if (/\.(ts|tsx)$/.test(entrada) && !/\.test\.tsx?$/.test(entrada)) {
      salida.push(p);
    }
  }
  return salida;
}

/** ¿El archivo declara `"use client"` en su primera directiva? */
function esCliente(fuente: string): boolean {
  // La directiva tiene que ser lo primero del módulo salvo comentarios.
  const sinComentarios = fuente
    .replace(/^\uFEFF/, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .trimStart();
  return /^["']use client["']/.test(sinComentarios);
}

/**
 * Los nombres que el módulo exporta. Cubre las formas que aparecen en el repo:
 * `export function X`, `export const X`, `export class X`, `export type X` y
 * las listas `export { A, B }`.
 */
function exportaciones(fuente: string): string[] {
  const nombres = new Set<string>();
  const directo = /export\s+(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/g;
  for (const m of Array.from(fuente.matchAll(directo))) nombres.add(m[1]);
  const lista = /export\s*\{([^}]*)\}/g;
  for (const m of Array.from(fuente.matchAll(lista))) {
    for (const parte of m[1].split(",")) {
      const alias = parte.split(/\s+as\s+/);
      const n = (alias[1] ?? alias[0] ?? "").trim();
      if (n && n !== "default") nombres.add(n);
    }
  }
  return Array.from(nombres);
}

/** Un componente, por convención del repo, es PascalCase. */
function esComponente(nombre: string): boolean {
  return /^[A-Z]/.test(nombre);
}

/** Resuelve el especificador de un import a una ruta absoluta del repo. */
function resolverImport(desde: string, especificador: string): string | null {
  let base: string;
  if (especificador.startsWith("@/")) {
    base = join(RAIZ, especificador.slice(2));
  } else if (especificador.startsWith(".")) {
    base = resolve(dirname(desde), especificador);
  } else {
    return null; // paquete de node_modules
  }
  for (const ext of EXTENSIONES) {
    if (existsSync(base + ext)) return base + ext;
  }
  for (const ext of EXTENSIONES) {
    const idx = join(base, "index" + ext);
    if (existsSync(idx)) return idx;
  }
  return existsSync(base) ? base : null;
}

/** Los `import { a, b } from "x"` de un archivo, ya resueltos. */
function importsConNombres(
  archivo: string,
  fuente: string
): { destino: string; nombres: string[] }[] {
  const salida: { destino: string; nombres: string[] }[] = [];
  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  for (const m of Array.from(fuente.matchAll(re))) {
    const destino = resolverImport(archivo, m[2]);
    if (!destino) continue;
    const nombres = m[1]
      .split(",")
      .map((p: string) => (p.split(/\s+as\s+/)[0] ?? "").replace(/^\s*type\s+/, "").trim())
      .filter(Boolean);
    salida.push({ destino, nombres });
  }
  return salida;
}

test('ningún módulo de servidor importa una función de un módulo "use client"', () => {
  const archivos = recorrer(RAIZ);
  const fuentes = new Map(archivos.map((a) => [a, readFileSync(a, "utf8")]));

  // Lo que cada módulo cliente exporta y NO es un componente.
  const noComponentesDeCliente = new Map<string, string[]>();
  for (const [archivo, fuente] of Array.from(fuentes.entries())) {
    if (!esCliente(fuente)) continue;
    const sueltos = exportaciones(fuente).filter((n) => !esComponente(n));
    if (sueltos.length > 0) noComponentesDeCliente.set(archivo, sueltos);
  }

  const infracciones: string[] = [];
  for (const [archivo, fuente] of Array.from(fuentes.entries())) {
    if (esCliente(fuente)) continue; // cliente → cliente es legítimo
    for (const { destino, nombres } of importsConNombres(archivo, fuente)) {
      const prohibidos = noComponentesDeCliente.get(destino);
      if (!prohibidos) continue;
      for (const n of nombres) {
        if (prohibidos.includes(n)) {
          infracciones.push(
            `  ${archivo.split(sep + "src" + sep)[1] ?? archivo}\n` +
              `      importa "${n}" de un módulo "use client"\n` +
              `      (${destino.split(sep + "src" + sep)[1] ?? destino})`
          );
        }
      }
    }
  }

  assert.equal(
    infracciones.length,
    0,
    `\n\nUn Server Component está importando algo que NO es un componente desde un\n` +
      `módulo "use client". En tiempo de ejecución NO recibe la función: recibe la\n` +
      `referencia de cliente, y llamarla lanza "… is not a function".\n\n` +
      infracciones.join("\n") +
      `\n\nArreglo: mover eso a un módulo SIN "use client" e importarlo desde los dos\n` +
      `lados. Precedente: src/lib/finanzas/reports/fecha-larga.ts (09/09/2026).\n`
  );
});
