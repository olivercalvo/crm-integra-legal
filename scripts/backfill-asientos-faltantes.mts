/**
 * POSTEO DE DOCUMENTOS EXISTENTES, POR MES — la herramienta de STAGING.
 *
 *   npx tsx scripts/backfill-asientos-faltantes.mts --mes 2026-07              (en seco: sólo el Excel)
 *   npx tsx scripts/backfill-asientos-faltantes.mts --mes 2026-07 --real       (contabiliza el mes)
 *   npx tsx scripts/backfill-asientos-faltantes.mts --desde 2026-07-01 --hasta 2026-08-31 [--real]
 *   … [--salida carpeta]   (por defecto docs/finanzas/posteo-retroactivo)
 *
 * Reemplaza al backfill viejo de staging (dos documentos puntuales de abril y
 * junio, que con la 096 quedaron contabilizados fuera). La lógica es la de la
 * app (`contabilidad/posteo-retroactivo.ts`); en producción se usa desde la
 * pantalla /finanzas/asientos/documentos-existentes, NUNCA con este script.
 *
 * EN SECO no escribe nada: arma el plan y deja un Excel por período para el
 * contador. REAL contabiliza el período en UNA transacción (097): o entra todo
 * o no entra nada. Correrlo de nuevo no duplica: sólo toma documentos sin
 * asiento, y si no queda ninguno lo dice.
 *
 * 🛑 Sólo staging (candado por project ref).
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const PROD = "uqmmkklbhzxqybljiecs";
const STAGING = "xtyenhakplrkyifbcaow";
const T = "a0000000-0000-0000-0000-000000000001";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const REAL = process.argv.includes("--real");
const DOBLE = process.argv.includes("--dos-a-la-vez");
const SALIDA = resolve(process.cwd(), arg("--salida") ?? "docs/finanzas/posteo-retroactivo");

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")])
);
const URL_SB = env.NEXT_PUBLIC_SUPABASE_URL as string;
if (!URL_SB || URL_SB.includes(PROD) || !URL_SB.includes(STAGING)) {
  console.error("\n🛑 ABORTADO: este script sólo corre contra staging.\n");
  process.exit(1);
}
process.env.NEXT_PUBLIC_SUPABASE_URL = URL_SB;
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const cargar = async <M,>(ruta: string): Promise<M> => {
  const m = (await import(ruta)) as M & { default?: M };
  return (m.default ?? m) as M;
};
const retro = await cargar<typeof import("../src/lib/finanzas/contabilidad/posteo-retroactivo")>(
  "../src/lib/finanzas/contabilidad/posteo-retroactivo"
);
const { excelDelPlan } = await cargar<typeof import("../src/lib/finanzas/contabilidad/posteo-retroactivo-excel")>(
  "../src/lib/finanzas/contabilidad/posteo-retroactivo-excel"
);
const { createAdminClient } = await cargar<typeof import("../src/lib/supabase/admin")>("../src/lib/supabase/admin");

let desde = arg("--desde");
let hasta = arg("--hasta");
const mes = arg("--mes");
if (mes) ({ desde, hasta } = retro.rangoDelMes(mes));
if (!desde || !hasta) {
  console.error("Uso: --mes AAAA-MM  |  --desde AAAA-MM-DD --hasta AAAA-MM-DD   [--real]");
  process.exit(1);
}

// El usuario: el admin de staging (queda como autor del lote y en la bitácora).
const anon = createClient(URL_SB, env.SUPABASE_SERVICE_ROLE_KEY as string, { auth: { persistSession: false } });
const { data: admin } = await anon.from("users").select("id").eq("tenant_id", T).eq("role", "admin").limit(1).maybeSingle();
const userId = (admin as { id: string } | null)?.id ?? null;
const db = createAdminClient(userId);

console.log(`\n▶ ${REAL ? "REAL" : "EN SECO"} · ${desde} → ${hasta}\n`);
const plan = await retro.planearPosteo(db as never, T, desde, hasta);

console.log(`   Asientos: ${plan.items.length}`);
for (const t of retro.ORDEN_DE_TIPOS) {
  const n = plan.items.filter((i) => i.tipo === t).length;
  if (n) console.log(`     · ${retro.ETIQUETA_DE_TIPO[t]}: ${n}`);
}
const tot = retro.totalesPorCuenta(plan.items);
const deb = tot.reduce((s, t) => s + t.debito, 0);
const cre = tot.reduce((s, t) => s + t.credito, 0);
console.log(`   Débitos ${deb.toFixed(2)} · Créditos ${cre.toFixed(2)}`);
console.log(`   No se contabilizan: ${plan.excluidos.length} · Con problemas: ${plan.problemas.length}`);
for (const x of plan.excluidos) console.log(`     ⏭  ${retro.ETIQUETA_DE_TIPO[x.tipo]} ${x.numero} (${x.fecha}): ${x.motivo}`);
for (const x of plan.problemas) console.log(`     ⚠️  ${retro.ETIQUETA_DE_TIPO[x.tipo]} ${x.numero} (${x.fecha}): ${x.motivo}`);
for (const a of plan.avisos) console.log(`   ℹ️  ${a}`);
for (const b of plan.bloqueos) console.log(`   🛑 ${b}`);

mkdirSync(SALIDA, { recursive: true });
const archivo = resolve(SALIDA, `en-seco-${plan.desde}_${plan.hasta}.xlsx`);
if (plan.items.length === 0 && existsSync(archivo)) {
  // Un período ya contabilizado no pisa el Excel con el que se revisó.
  console.log(`\n   Excel: no se reescribe ${archivo} (el plan está vacío).`);
} else {
  writeFileSync(archivo, excelDelPlan(plan, new Date().toLocaleString("es-PA", { timeZone: "America/Panama" })));
  console.log(`\n   Excel: ${archivo}`);
}

if (!REAL) {
  console.log("\n✅ En seco: no se escribió nada.\n");
  process.exit(0);
}
if (DOBLE) {
  // Cada corrida con su propio plan y su propio cliente, como dos personas.
  const otro = createAdminClient(userId);
  const plan2 = await retro.planearPosteo(otro as never, T, desde, hasta);
  const rs = await Promise.allSettled([
    retro.contabilizarPlan(db as never, db as never, plan, userId),
    retro.contabilizarPlan(otro as never, otro as never, plan2, userId),
  ]);
  rs.forEach((r, i) =>
    console.log(r.status === "fulfilled"
      ? `   corrida ${i + 1}: ✅ lote ${r.value.posteoId}, ${r.value.asientos.length} asientos (${r.value.asientos[0]?.entry_number} a ${r.value.asientos.at(-1)?.entry_number})`
      : `   corrida ${i + 1}: ✖ ${(r.reason as Error).message}`));
  const ok = rs.filter((r) => r.status === "fulfilled").length;
  console.log(ok === 1 ? "\n✅ Una contabilizó, la otra no escribió nada.\n" : `\n❌ ${ok} corridas contabilizaron.\n`);
  process.exit(ok === 1 ? 0 : 1);
}
try {
  const r = await retro.contabilizarPlan(db as never, db as never, plan, userId);
  console.log(`\n✅ Contabilizado: lote ${r.posteoId}, ${r.asientos.length} asientos (${r.asientos[0]?.entry_number} a ${r.asientos.at(-1)?.entry_number}), débitos ${r.totalDebitos.toFixed(2)}\n`);
} catch (err) {
  console.error(`\n❌ ${(err as Error).message}\n`);
  process.exit(1);
}
