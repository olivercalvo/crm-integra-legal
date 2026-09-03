/**
 * Siembra en STAGING un gasto de trámite COMPUESTO y lo postea al libro.
 *
 *   npx tsx scripts/seed-gasto-tramite-demo.mts
 *   npx tsx scripts/seed-gasto-tramite-demo.mts --dry-run
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * PARA QUÉ EXISTE
 * ═════════════════════════════════════════════════════════════════════════════
 * Para poder probar en pantalla **la cadena completa**, que es lo que Josuarth
 * pidió y lo que RM va a querer ver:
 *
 *   Libro Mayor → el asiento → el ícono del documento → `/finanzas/gastos-tramite/{id}`
 *
 * Sin un asiento de tipo `gasto_tramite` en el libro, esa cadena no se puede
 * recorrer: el mayor no tiene ningún renglón que enlace a la pantalla nueva.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ TRES LÍNEAS CONTRA TRES CUENTAS
 * ─────────────────────────────────────────────────────────────────────────────
 * Los 20 gastos de staging tienen UNA línea cada uno (los creó el backfill de la
 * `036`, que hace una por gasto). Un asiento de una línea no demuestra nada de lo
 * que se construyó.
 *
 * Con tres líneas contra cuentas distintas se ve:
 *   · el asiento COMPUESTO — 3 débitos contra 1 crédito, cuadrando;
 *   · en el mayor de `130003`, la contrapartida dice "Cuentas por pagar" (hay una
 *     sola línea del lado opuesto);
 *   · en el mayor de `200001`, dice **"Varios"** — el caso ambiguo que
 *     `contrapartida.ts` ya resolvía y que hasta hoy no se podía ver;
 *   · en el detalle del gasto, las tres líneas con sus cuentas.
 *
 * Reproduce el gasto del fixture del 15/03 que motivó todo el modelo de líneas:
 * se muestra como "Honorarios Profesionales 1.497,85" y su asiento lo parte en
 * útiles 412,35 / honorarios 900,00 / mensajería 185,50.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USA EL CÓDIGO REAL, NO UNA COPIA
 * ─────────────────────────────────────────────────────────────────────────────
 * Importa `construirAsientoDeGastoTramite()` y `postJournalEntry()` — el mismo
 * camino que recorre `POST /api/expenses/[id]/post-to-ledger` después de resolver
 * la sesión. Lo único que no ejercita es el gate de auth y las tres capas de
 * idempotencia, que están cubiertas por `post-to-ledger.route.test.ts`.
 *
 * IDEMPOTENTE: si el gasto de demostración ya existe, no crea otro ni vuelve a
 * postear. Se reconoce por su `concept`.
 *
 * 🛑 CANDADO ANTI-PRODUCCIÓN: aborta si la URL no es la de staging.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const DRY_RUN = process.argv.includes("--dry-run");

// ---------------------------------------------------------------------------
// CANDADO
// ---------------------------------------------------------------------------
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const URL_SB = env.NEXT_PUBLIC_SUPABASE_URL as string;
const PROD = "uqmmkklbhzxqybljiecs";
const STAGING = "xtyenhakplrkyifbcaow";

if (!URL_SB) {
  console.error("\n🛑 No se pudo leer NEXT_PUBLIC_SUPABASE_URL de .env.local\n");
  process.exit(1);
}
if (URL_SB.includes(PROD)) {
  console.error("\n🛑 ABORTADO: la URL apunta a PRODUCCIÓN. Este script NO corre ahí.\n");
  process.exit(1);
}
if (!URL_SB.includes(STAGING)) {
  console.error(`\n🛑 ABORTADO: URL inesperada (${URL_SB}). Solo staging.\n`);
  process.exit(1);
}
console.log(`✅ CANDADO OK — staging${DRY_RUN ? "  ·  DRY RUN (no escribe)" : ""}\n`);

const db = createClient(URL_SB, env.SUPABASE_SERVICE_ROLE_KEY as string, {
  auth: { persistSession: false },
});

const { postJournalEntry } = await import("../src/lib/finanzas/contabilidad/posting.ts");
const { construirAsientoDeGastoTramite } = await import(
  "../src/lib/finanzas/contabilidad/asiento-gasto-tramite.ts"
);

const money = (n: number) =>
  n.toLocaleString("es-PA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------------------------------------------------------------------------
// EL GASTO
// ---------------------------------------------------------------------------
const CONCEPTO = "Trámite Registro Público — aumento de capital (demostración)";
const FECHA = "2026-03-15";

/** Las tres líneas del gasto del fixture del 15/03. */
const LINEAS = [
  { orden: 1, desc: "Útiles y timbres fiscales", cuenta: "130003", monto: 412.35 },
  // 🔴 `500004`, NO `610002`. La primera versión de este script usó
  // `610002 Honorarios Profesionales` y estaba MAL: esa es la cuenta de los
  // honorarios que paga el bufete por LO SUYO —su contador, su propio abogado—.
  // El gestor externo de un caso es un servicio de tercero comprado PARA el
  // caso, o sea `500004 Honorarios Profesionales Externos`, que es de costo.
  //
  // Las dos se llaman casi igual y el error lo cometió quien acababa de diseñar
  // este modelo. Es la evidencia que motivó la lista corta de siete cuentas —
  // ver `contabilidad/cuentas-de-gasto.ts`.
  { orden: 2, desc: "Honorario del gestor externo", cuenta: "500004", monto: 900.0 },
  { orden: 3, desc: "Mensajería y traslados", cuenta: "500005", monto: 185.5 },
];
const TOTAL = LINEAS.reduce((s, l) => s + l.monto, 0);

// ---------------------------------------------------------------------------
// FOTO ANTES / DESPUÉS del Balance
// ---------------------------------------------------------------------------
async function totalesDelBalance() {
  const { data: cuentas } = await db
    .from("chart_of_accounts")
    .select("id, code, saldo_inicial, account_type, active");
  const { data: lineas } = await db
    .from("journal_entry_lines")
    .select("account_id, debit, credit");

  const neto = new Map<string, number>();
  for (const l of lineas ?? []) {
    const k = String((l as { account_id: string }).account_id);
    const v = Number((l as { debit: number }).debit) - Number((l as { credit: number }).credit);
    neto.set(k, (neto.get(k) ?? 0) + v);
  }

  let activo = 0, pasivo = 0, patrimonio = 0, resultado = 0;
  for (const c of (cuentas ?? []) as Record<string, unknown>[]) {
    if (c.active !== true) continue;
    const saldo = Number(c.saldo_inicial ?? 0) + (neto.get(String(c.id)) ?? 0);
    const t = String(c.account_type);
    if (t === "asset") activo += saldo;
    else if (t === "liability") pasivo += saldo;
    else if (t === "equity") patrimonio += saldo;
    else resultado += saldo;
  }

  // Convención BALANZA (débito +, crédito −). Se presenta en positivo, y la
  // utilidad del ejercicio es el opuesto del neto de las cuentas de resultado.
  // El `+ 0` no es adorno: sin él, Math.round(-0.001 * 100) / 100 da `-0` y el
  // descuadre se imprime como "-0.00", que parece un problema y no lo es.
  const r2 = (n: number) => Math.round(n * 100) / 100 + 0;
  const utilidad = r2(-resultado);
  const patrimonioTotal = r2(-patrimonio + utilidad);
  return {
    activo: r2(activo),
    pasivo: r2(-pasivo),
    patrimonio: patrimonioTotal,
    utilidad,
    descuadre: r2(activo - -pasivo - patrimonioTotal),
  };
}

function imprimir(titulo: string, t: Awaited<ReturnType<typeof totalesDelBalance>>) {
  console.log(`  ${titulo}`);
  console.log(`    Activo ............. ${money(t.activo)}`);
  console.log(`    Pasivo ............. ${money(t.pasivo)}`);
  console.log(`    Patrimonio ......... ${money(t.patrimonio)}  (utilidad ${money(t.utilidad)})`);
  console.log(`    DESCUADRE .......... ${money(t.descuadre)}`);
}

// ---------------------------------------------------------------------------
const TENANT = "a0000000-0000-0000-0000-000000000001";

const antes = await totalesDelBalance();
console.log("📊 BALANCE ANTES");
imprimir("", antes);
console.log("");

// ¿Ya existe? Idempotencia.
const { data: existente } = await db
  .from("expenses")
  .select("id, posted_entry_id")
  .eq("tenant_id", TENANT)
  .eq("concept", CONCEPTO)
  .maybeSingle();

if (existente) {
  console.log(`ℹ️  El gasto de demostración ya existe (${existente.id}).`);
  // ⚠️ Si el asiento ya se posteó con la clasificación vieja, NO se puede
  // arreglar: los asientos son inmutables y el trigger de la `038` bloquea la
  // edición de las líneas de un gasto asentado. La única salida es re-sembrar
  // staging. Se avisa en vez de fallar en silencio.
  const { data: lineaVieja } = await db
    .from("expense_lines")
    .select("id")
    .eq("expense_id", existente.id)
    .eq("chart_account_code", "610002")
    .maybeSingle();

  if (lineaVieja) {
    console.log("");
    console.log("⚠️  Este gasto tiene una línea contra 610002, que es la clasificación");
    console.log("   ERRÓNEA de la primera versión de este script. La correcta es 500004.");
    console.log("   Si el gasto ya está posteado NO se puede corregir: los asientos son");
    console.log("   inmutables. Para dejarlo bien hay que re-sembrar staging.");
    console.log("");
  }

  if (existente.posted_entry_id) {
    const { data: e } = await db
      .from("journal_entries")
      .select("entry_number")
      .eq("id", existente.posted_entry_id)
      .maybeSingle();
    console.log(`   Ya está posteado — asiento ${e?.entry_number}. No se hace nada.\n`);
    process.exit(0);
  }
  console.log("   Existe pero NO está posteado. Se postea.\n");
}

// Un caso y un usuario reales para colgar el gasto.
const { data: caso } = await db
  .from("cases")
  .select("id, case_code")
  .eq("tenant_id", TENANT)
  .order("case_code")
  .limit(1)
  .maybeSingle();
const { data: usuario } = await db
  .from("users")
  .select("id")
  .eq("tenant_id", TENANT)
  .in("role", ["admin", "abogada"])
  .limit(1)
  .maybeSingle();

if (!caso || !usuario) {
  console.error("🛑 Falta un caso o un usuario en staging. Corré `npm run seed:staging`.\n");
  process.exit(1);
}

console.log(`📄 Gasto: ${CONCEPTO}`);
console.log(`   caso ${caso.case_code} · ${FECHA} · total ${money(TOTAL)}`);
for (const l of LINEAS) {
  console.log(`     ${l.orden}. ${l.cuenta}  ${l.desc.padEnd(32)} ${money(l.monto).padStart(10)}`);
}
console.log("");

if (DRY_RUN) {
  console.log("DRY RUN — no se escribió nada.\n");
  process.exit(0);
}

// 1. El encabezado.
let expenseId = existente?.id as string | undefined;
if (!expenseId) {
  const { data: creado, error } = await db
    .from("expenses")
    .insert({
      tenant_id: TENANT,
      case_id: caso.id,
      amount: TOTAL,
      concept: CONCEPTO,
      date: FECHA,
      expense_type: "tramite",
      registered_by: usuario.id,
    })
    .select("id")
    .single();
  if (error) throw new Error(`crear gasto: ${error.message}`);
  expenseId = creado.id as string;
  console.log(`✅ Gasto creado — ${expenseId}`);

  // 2. Las tres líneas, YA clasificadas (un gasto nuevo no puede nacer sin cuenta).
  const { error: errL } = await db.from("expense_lines").insert(
    LINEAS.map((l) => ({
      tenant_id: TENANT,
      expense_id: expenseId,
      line_order: l.orden,
      description: l.desc,
      chart_account_code: l.cuenta,
      amount: l.monto,
      tax_rate: 0,
      tax_amount: 0,
      created_by: usuario.id,
    }))
  );
  if (errL) throw new Error(`crear líneas: ${errL.message}`);
  console.log(`✅ ${LINEAS.length} líneas creadas`);
}

// 3. El asiento, con el código REAL de la ruta.
const { data: lineasDb } = await db
  .from("expense_lines")
  .select("id, line_order, description, chart_account_code, amount, tax_rate, tax_amount, line_total")
  .eq("tenant_id", TENANT)
  .eq("expense_id", expenseId)
  .order("line_order");

const armado = construirAsientoDeGastoTramite(
  {
    id: expenseId!,
    date: FECHA,
    concept: CONCEPTO,
    case_code: caso.case_code as string,
    supplier_legal_name: null,
  },
  (lineasDb ?? []).map((l) => ({
    ...(l as Record<string, unknown>),
    chart_account_name: null,
  })) as never
);

if (!armado.ok) {
  console.error(`\n🛑 El asiento no se pudo armar: ${armado.mensaje}\n`);
  process.exit(1);
}

const entryId = await postJournalEntry(db, TENANT, armado.asiento, usuario.id);
const { data: asiento } = await db
  .from("journal_entries")
  .select("entry_number")
  .eq("id", entryId)
  .maybeSingle();

await db.from("expenses").update({ posted_entry_id: entryId }).eq("id", expenseId);

console.log(`✅ Asiento ${asiento?.entry_number} posteado (${armado.asiento.lines.length} líneas)`);
console.log("");

const despues = await totalesDelBalance();
console.log("📊 BALANCE DESPUÉS");
imprimir("", despues);
console.log("");
console.log("   Δ Activo ............ " + money(despues.activo - antes.activo));
console.log("   Δ Pasivo ............ " + money(despues.pasivo - antes.pasivo));
console.log("   Δ Patrimonio ........ " + money(despues.patrimonio - antes.patrimonio));
console.log("");

if (Math.abs(despues.descuadre) >= 0.005) {
  console.error(`🛑 EL BALANCE QUEDÓ DESCUADRADO EN ${money(despues.descuadre)}\n`);
  process.exit(1);
}
console.log(`🔗 La pantalla:  /finanzas/gastos-tramite/${expenseId}`);
console.log(`🔗 El mayor:     /finanzas/reportes/mayor  (cuentas 130003, 610002, 500005, 200001)\n`);
