/**
 * 🔒 Toda ruta que ESCRIBE le dice a la base quién es el usuario (03/10/2026).
 *
 * Las bitácoras de auditoría (086/087) se llenan con triggers en la base. Con la
 * clave de servicio `auth.uid()` es NULL, así que el usuario llega en el header
 * `x-actor-id` que pone `createAdminClient(actorId)`. Una ruta que crea el cliente
 * sin usuario deja cada cambio como «sistema»: el registro existe pero no dice
 * quién fue, que es justo lo que pidió Josuarth.
 *
 * Excepción declarada en el lugar: un comentario `actor-ok: <motivo>` en la línea
 * anterior (el cron, el portal público de cotizaciones).
 *
 * Ejecución:  npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function archivos(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) archivos(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !p.includes("__tests__")) out.push(p);
  }
  return out;
}

const RUTAS = archivos(join(process.cwd(), "src/app/api")).filter((f) => f.endsWith("route.ts"));
const MUTA = /export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/;

test("createAdminClient exige el usuario: la firma no tiene valor por defecto", () => {
  const fuente = readFileSync(join(process.cwd(), "src/lib/supabase/admin.ts"), "utf8");
  assert.match(fuente, /export function createAdminClient\(actorId: string \| null\)/);
  assert.match(fuente, /"x-actor-id": actorId/);
});

test("el contexto autenticado de las rutas de Finanzas manda el usuario", () => {
  const fuente = readFileSync(join(process.cwd(), "src/lib/supabase/server-query.ts"), "utf8");
  assert.match(fuente, /const admin = createAdminClient\(user\.id\);/);
});

test("🔒 ninguna ruta que escribe crea el cliente de servicio sin usuario", () => {
  const problemas: string[] = [];
  for (const f of RUTAS) {
    const fuente = readFileSync(f, "utf8");
    if (!MUTA.test(fuente)) continue;
    const lineas = fuente.split("\n");
    lineas.forEach((l, i) => {
      if (!/createAdminClient\(/.test(l) || l.trim().startsWith("*") || l.trim().startsWith("//")) return;
      const sinUsuario = /createAdminClient\(\s*(null)?\s*\)/.test(l);
      const declarado = /actor-ok:/.test(lineas.slice(Math.max(0, i - 3), i).join("\n"));
      if (sinUsuario && !declarado) problemas.push(`   · ${f.replace(process.cwd(), "")}:${i + 1}`);
    });
  }
  assert.deepEqual(problemas, [], `\nRutas que escriben sin decir quién:\n${problemas.join("\n")}\n`);
});

test("las excepciones son pocas y están a la vista", () => {
  let n = 0;
  for (const f of archivos(join(process.cwd(), "src"))) {
    n += (readFileSync(f, "utf8").match(/actor-ok:/g) ?? []).length;
  }
  assert.ok(n <= 4, `hay ${n} excepciones actor-ok; cada una nueva es una decisión, no un atajo`);
});
