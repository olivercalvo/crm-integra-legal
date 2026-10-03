/**
 * Si falla el registro de auditoría (091): la persona ve un mensaje claro y el
 * error real queda en el log del servidor (03/10/2026, prueba 3).
 *
 * Ejecución:  npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

import {
  CODIGO_FALLA_AUDITORIA,
  MENSAJE_FALLA_AUDITORIA,
  conManejoDeAuditoria,
  fetchConAuditoria,
} from "@/lib/auditoria/error-de-auditoria";

const respuestaPostgrest = (status: number, cuerpo: unknown) =>
  (async () => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } })) as typeof fetch;

const falla = {
  code: "AU001",
  message: MENSAJE_FALLA_AUDITORIA,
  details: "[42804] COALESCE types text and integer cannot be matched",
  hint: "auditoria.registrar · INSERT comments",
};

/** Lo que hace una ruta cualquiera: escribe, y si hay error responde con SU texto. */
const rutaDeComentario = (f: typeof fetch) =>
  conManejoDeAuditoria(async (req: Request) => {
    void req;
    const r = await f("https://x.supabase.co/rest/v1/comments?select=*", { method: "POST" });
    if (!r.ok) return NextResponse.json({ error: "Error al agregar el comentario" }, { status: 500 });
    return NextResponse.json({ ok: true }, { status: 201 });
  });

function capturarLog() {
  const lineas: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => void lineas.push(a.map(String).join(" "));
  return { lineas, restaurar: () => void (console.error = original) };
}

test("AU001: la persona ve el mensaje claro y el error real queda en el log", async () => {
  const log = capturarLog();
  try {
    const res = await rutaDeComentario(fetchConAuditoria(respuestaPostgrest(400, falla)))(new Request("http://l/api/comments"));
    assert.equal(res.status, 500);
    const j = await res.json();
    assert.equal(j.error, MENSAJE_FALLA_AUDITORIA);
    assert.equal(j.codigo, CODIGO_FALLA_AUDITORIA);
    assert.equal(log.lineas.length, 1);
    assert.match(log.lineas[0], /COALESCE types text and integer cannot be matched/);
    assert.match(log.lineas[0], /INSERT comments/);
    assert.match(log.lineas[0], /POST \/rest\/v1\/comments/);
    assert.doesNotMatch(log.lineas[0], /select=/, "la ruta de PostgREST va sin parámetros");
  } finally {
    log.restaurar();
  }
});

test("otro error de la base: la ruta responde lo suyo, como siempre", async () => {
  const log = capturarLog();
  try {
    const res = await rutaDeComentario(fetchConAuditoria(respuestaPostgrest(409, { code: "23505", message: "duplicate key" })))(new Request("http://l"));
    assert.equal((await res.json()).error, "Error al agregar el comentario");
    assert.equal(log.lineas.length, 0);
  } finally {
    log.restaurar();
  }
});

test("si la ruta igual respondió bien, no se toca (lo que guardó, guardó)", async () => {
  const log = capturarLog();
  try {
    const h = conManejoDeAuditoria(async () => {
      await fetchConAuditoria(respuestaPostgrest(400, falla))("https://x/rest/v1/audit_log", { method: "POST" });
      return NextResponse.json({ ok: true }, { status: 200 });
    });
    assert.equal((await h()).status, 200);
  } finally {
    log.restaurar();
  }
});

test("una excepción después de AU001 también da el mensaje claro; sin AU001 se relanza", async () => {
  const log = capturarLog();
  try {
    const conFalla = conManejoDeAuditoria(async () => {
      await fetchConAuditoria(respuestaPostgrest(400, falla))("https://x/rest/v1/rpc/post_journal_entry", { method: "POST" });
      throw new Error("la ruta no esperaba esto");
    });
    assert.equal((await (await conFalla()).json()).error, MENSAJE_FALLA_AUDITORIA);
    const sinFalla = conManejoDeAuditoria(async () => {
      throw new Error("otra cosa");
    });
    await assert.rejects(sinFalla(), /otra cosa/);
  } finally {
    log.restaurar();
  }
});

test("el cuerpo de la respuesta sigue disponible para supabase-js", async () => {
  const log = capturarLog();
  try {
    const r = await fetchConAuditoria(respuestaPostgrest(400, falla))("https://x/rest/v1/comments", { method: "POST" });
    assert.equal((await r.json()).code, "AU001");
  } finally {
    log.restaurar();
  }
});

test("dos peticiones a la vez: la falla de una no contamina a la otra", async () => {
  const log = capturarLog();
  try {
    const lenta = (cuerpo: unknown, status: number) =>
      (async () => {
        await new Promise((r) => setTimeout(r, 20));
        return new Response(JSON.stringify(cuerpo), { status });
      }) as typeof fetch;
    const [a, b] = await Promise.all([
      rutaDeComentario(fetchConAuditoria(lenta(falla, 400)))(new Request("http://l")),
      rutaDeComentario(fetchConAuditoria(lenta({ code: "23505" }, 409)))(new Request("http://l")),
    ]);
    assert.equal((await a.json()).error, MENSAJE_FALLA_AUDITORIA);
    assert.equal((await b.json()).error, "Error al agregar el comentario");
  } finally {
    log.restaurar();
  }
});

// ── Que esté conectado en todas partes ──────────────────────────────────────

function rutas(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? rutas(p) : n === "route.ts" ? [p] : [];
  });
}

test("🔒 todo handler de src/app/api está envuelto en conManejoDeAuditoria", () => {
  const sueltos: string[] = [];
  let envueltos = 0;
  for (const f of rutas("src/app/api")) {
    const s = readFileSync(f, "utf8");
    for (const m of s.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) sueltos.push(`${f}: ${m[1]}`);
    for (const m of s.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=\s*(\w+)/g)) {
      if (m[2] === "conManejoDeAuditoria") envueltos++;
      else sueltos.push(`${f}: ${m[1]} = ${m[2]}(…)`);
    }
  }
  assert.deepEqual(sueltos, [], "handlers sin envolver");
  assert.ok(envueltos > 150, `se esperaban más de 150 handlers envueltos y hay ${envueltos}`);
});

test("🔒 los dos clientes de Supabase del servidor pasan por fetchConAuditoria", () => {
  for (const f of ["src/lib/supabase/admin.ts", "src/lib/supabase/server.ts"]) {
    assert.match(readFileSync(f, "utf8"), /fetch:\s*fetchConAuditoria\(\)/, f);
  }
});

test("🔒 el mensaje es el mismo en la base (091) y en la app, y sin «—»", () => {
  const sql = readFileSync("sql/pending/091_bitacoras_error_claro.sql", "utf8");
  assert.ok(sql.includes(`MESSAGE = '${MENSAJE_FALLA_AUDITORIA}'`));
  assert.ok(sql.includes(`ERRCODE = '${CODIGO_FALLA_AUDITORIA}'`));
  assert.ok(!MENSAJE_FALLA_AUDITORIA.includes("—"));
});
