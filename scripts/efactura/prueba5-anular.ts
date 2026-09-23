/**
 * PRUEBA 5, PASO 3 — medir la respuesta EXITOSA de `CreateCancellation`.
 *
 *   npx tsx scripts/efactura/prueba5-anular.ts <invoice_id>
 *
 * Es la pregunta que el Bloque 9B dejó abierta a propósito: el clasificador
 * tiene una clase `indeterminada` porque **nunca vimos cómo se ve un éxito**, y
 * suponerlo («HTTP 200 con array vacío debe ser que salió bien») tendría una
 * consecuencia concreta: si la suposición es falsa, el orquestador revierte el
 * asiento y marca la factura anulada mientras el documento sigue vivo ante la
 * DGI.
 *
 * Corre **el orquestador del CRM**, no una llamada suelta: `anularFacturaAnteDgi`
 * es exactamente lo que ejecuta `POST /api/finanzas/invoices/[id]/cancel`. Lo
 * que se mide es el camino real.
 *
 * Tres cosas, en este orden:
 *
 *   1. La anulación. Se guarda la respuesta CRUDA del PAC desde
 *      `fe_anulaciones.response_payload`, que es donde el orquestador la deja.
 *   2. Un segundo pedido de anulación sobre el MISMO CUFE, para confirmar el
 *      `0622` y que el clasificador lo lea como `ya_anulada`.
 *   3. El orquestador OTRA VEZ, para verificar que **no duplica nada**: con la
 *      factura ya anulada de los dos lados, la matriz devuelve `nada_que_hacer`
 *      y la llamada tiene que rebotar sin escribir.
 *
 * Y al final cuenta las notas de crédito y los asientos de reversión: uno de
 * cada uno, no dos.
 *
 * 🔴 Imprime y verifica `i_amb = 2` antes de cada llamada al PAC.
 * ESCRIBE EN STAGING: anula la factura de verdad. Es el punto.
 */
import * as dotenv from "dotenv";
import { resolve } from "path";
import { writeFileSync } from "fs";

dotenv.config({ path: resolve(__dirname, "../../.env.local") });

import { createClient } from "@supabase/supabase-js";
import { anularFacturaAnteDgi } from "../../src/lib/finanzas/efactura/orchestration/anular-factura-ante-dgi";
import { anularEnPac } from "../../src/lib/finanzas/efactura/transport/anulacion-en-pac";
import { clasificarRespuestaDeAnulacion } from "../../src/lib/finanzas/efactura/orchestration/clasificar-respuesta-de-anulacion";

const INVOICE_ID = process.argv[2];
const MOTIVO = "Prueba 5 del Bloque 9B: medir la respuesta exitosa de la anulacion";

const informe: string[] = [];
function anotar(l: string) {
  console.log(l);
  informe.push(l);
}
function volcar(t: string, v: unknown) {
  anotar(`\n${t}:`);
  anotar(JSON.stringify(v, null, 2));
}

function confirmarAmbiente(paso: string) {
  const iAmb = process.env.EFACTURA_I_AMB;
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV;
  anotar(`\n🔒 [${paso}] AMBIENTE: EFACTURA_I_AMB = ${iAmb}  ·  NEXT_PUBLIC_APP_ENV = ${appEnv}`);
  if (iAmb !== "2") throw new Error(`ABORTADO: EFACTURA_I_AMB = ${iAmb}. Sólo sandbox (2).`);
  if (appEnv === "production") throw new Error("ABORTADO: appEnv = production.");
}

async function main() {
  if (!INVOICE_ID) throw new Error("Falta el invoice_id.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan credenciales de Supabase en .env.local");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: inv } = await db
    .from("invoices")
    .select("id, tenant_id, invoice_number, status, fe_estado, dgi_cufe, issue_date")
    .eq("id", INVOICE_ID)
    .maybeSingle();
  if (!inv) throw new Error("No existe esa factura.");

  anotar("═".repeat(78));
  anotar("PRUEBA 5 — la respuesta EXITOSA de CreateCancellation");
  anotar(`fecha:   ${new Date().toISOString()}`);
  anotar(`factura: ${inv.invoice_number} · ${inv.status} · fe: ${inv.fe_estado}`);
  anotar(`CUFE:    ${inv.dgi_cufe}`);
  anotar("═".repeat(78));

  if (inv.fe_estado !== "authorized") {
    throw new Error(`La factura tiene fe_estado='${inv.fe_estado}'. Hace falta 'authorized'.`);
  }

  const { data: usuario } = await db
    .from("users").select("id").eq("tenant_id", inv.tenant_id).limit(1).maybeSingle();

  // ── 1. LA ANULACIÓN, por el mismo camino que la ruta de API ───────────────
  confirmarAmbiente("anulacion");
  anotar("→ anularFacturaAnteDgi (el orquestador del CRM)\n");

  const r = await anularFacturaAnteDgi(
    db as never,
    db as never,
    String(inv.tenant_id),
    String(usuario?.id ?? ""),
    String(inv.id),
    MOTIVO,
    null,
    new Date()
  );
  volcar("RESULTADO del orquestador", r);

  // La respuesta CRUDA del PAC, tal como el orquestador la guardó.
  const { data: intentos } = await db
    .from("fe_anulaciones")
    .select("intento, resultado, response_payload, i_amb, created_at")
    .eq("invoice_id", inv.id)
    .order("intento");

  for (const it of intentos ?? []) {
    anotar(`\n─── fe_anulaciones intento #${it.intento} · resultado=${it.resultado} · i_amb=${it.i_amb}`);
    volcar("🔴 RESPUESTA CRUDA DEL PAC", it.response_payload);
  }

  // ── 2. Segundo pedido sobre el mismo CUFE ─────────────────────────────────
  confirmarAmbiente("reintento-directo");
  anotar("→ POST CreateCancellation otra vez, mismo CUFE\n");
  const segunda = await anularEnPac({
    cufe: String(inv.dgi_cufe),
    cancellationReason: MOTIVO,
  });
  volcar("RESPUESTA (2ª vez)", segunda);
  volcar("CLASIFICADA como", clasificarRespuestaDeAnulacion(segunda));

  // ── 3. El orquestador otra vez: tiene que rebotar sin escribir ────────────
  anotar("\n→ anularFacturaAnteDgi otra vez (no debería escribir nada)");
  try {
    const r2 = await anularFacturaAnteDgi(
      db as never, db as never, String(inv.tenant_id), String(usuario?.id ?? ""),
      String(inv.id), MOTIVO, null, new Date()
    );
    anotar(`⚠️ NO rebotó: ${JSON.stringify(r2)}`);
  } catch (err) {
    anotar(`✅ rebotó: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Lo que quedó en la base ───────────────────────────────────────────────
  const { data: final } = await db
    .from("invoices")
    .select("status, fe_estado, credited_total, balance_due, cancellation_reason")
    .eq("id", inv.id).maybeSingle();
  const { data: ncs } = await db
    .from("credit_notes").select("credit_note_number, status").eq("invoice_id", inv.id);
  const { data: asientos } = await db
    .from("journal_entries")
    .select("entry_number, transaction_date, source_type, reverses_entry_id")
    .eq("source_id", inv.id).order("entry_number");

  anotar("\n" + "═".repeat(78));
  anotar("ESTADO FINAL");
  volcar("factura", final);
  anotar(`\nnotas de crédito: ${ncs?.length ?? 0}  →  ${(ncs ?? []).map((n) => n.credit_note_number).join(", ")}`);
  anotar(`asientos de la factura: ${asientos?.length ?? 0}`);
  for (const a of asientos ?? []) {
    anotar(`  #${a.entry_number} ${a.transaction_date} [${a.source_type}]${a.reverses_entry_id ? " (reversión)" : ""}`);
  }
  anotar("═".repeat(78));

  const salida = resolve(__dirname, "../../docs/efactura/prueba5-anulacion-exitosa.txt");
  writeFileSync(salida, informe.join("\n"), "utf8");
  console.log(`\n📄 informe: ${salida}`);
}

main().catch((err) => {
  console.error("\n❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
