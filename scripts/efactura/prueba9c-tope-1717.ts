/**
 * BLOQUE 9C — ¿LA DGI LIBERA EL MONTO CUANDO SE ANULA UNA NOTA DE CRÉDITO?
 *
 *   npx tsx scripts/efactura/prueba9c-tope-1717.ts
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * LA PREGUNTA
 * ═════════════════════════════════════════════════════════════════════════════
 * El 24/09/2026 medimos que la DGI **lleva su propia cuenta** de lo acreditado
 * por documento referenciado: rechaza con `[1717] Monto de las notas de crédito
 * o débito inconsistentes con el monto de la FE original referenciada` cuando
 * la suma se pasa.
 *
 * Lo que NO sabemos es si esa cuenta **se descuenta al anular una NC**. De eso
 * dependen dos cosas concretas:
 *
 *   · Si la DGI LIBERA el monto → su tope y nuestro `credited_total` coinciden,
 *     y no hay nada que hacer.
 *   · Si NO lo libera → nuestro tope está MAL para la DGI: podríamos dejar
 *     emitir una NC que ella va a rechazar. El tope tendría que contar también
 *     las NC fiscales anuladas, y la pantalla tiene que explicarlo.
 *
 * No se puede deducir: se mide.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * LA SECUENCIA
 * ═════════════════════════════════════════════════════════════════════════════
 *   1. Factura nueva de B/. 10.00 → emitida al sandbox → CUFE.
 *   2. NC de B/. 10.00 → contabilizada → emitida a la DGI → CUFE.
 *   3. Anular esa NC ANTE LA DGI (`CreateCancellation` con el CUFE de la NC).
 *   4. Reversarla en el libro, que devuelve `credited_total` a 0.
 *   5. Otra NC de B/. 10.00 sobre la MISMA factura → emitirla a la DGI.
 *
 * El paso 5 es la respuesta: si autoriza, libera; si da `[1717]`, no.
 *
 * 🔴 El cliente se apunta al RUC/DV del emisor —único receptor que el sandbox
 *    acepta— y se restaura en un `finally`.
 * 🔴 Imprime y verifica `i_amb = 2` antes de cada llamada.
 * 🔴 NO toca ninguna factura existente: crea la suya.
 *
 * ESCRIBE EN STAGING: crea una factura y dos NC, y quema correlativos.
 */
import * as dotenv from "dotenv";
import { resolve } from "path";
import { writeFileSync } from "fs";

dotenv.config({ path: resolve(__dirname, "../../.env.local") });

import { createClient } from "@supabase/supabase-js";
import { createInvoice, emitInvoice } from "../../src/lib/finanzas/api/invoices";
import { emitCreditNote, reverseCreditNote } from "../../src/lib/finanzas/api/credit-notes";
import { emitInvoiceToEfactura } from "../../src/lib/finanzas/efactura/orchestration/emit-invoice-to-efactura";
import { emitCreditNoteToEfactura } from "../../src/lib/finanzas/efactura/orchestration/emit-credit-note-to-efactura";
import { anularEnPac } from "../../src/lib/finanzas/efactura/transport/anulacion-en-pac";
import { clasificarRespuestaDeAnulacion } from "../../src/lib/finanzas/efactura/orchestration/clasificar-respuesta-de-anulacion";

const TENANT = "a0000000-0000-0000-0000-000000000001";

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
  anotar(`\n🔒 [${paso}] AMBIENTE: EFACTURA_I_AMB = ${iAmb} · NEXT_PUBLIC_APP_ENV = ${appEnv}`);
  if (iAmb !== "2") throw new Error(`ABORTADO: EFACTURA_I_AMB = ${iAmb}. Sólo sandbox (2).`);
  if (appEnv === "production") throw new Error("ABORTADO: appEnv = production.");
}

const hoy = new Date().toISOString().slice(0, 10);

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const rucEmisor = process.env.EFACTURA_EMISOR_RUC;
  const dvEmisor = process.env.EFACTURA_EMISOR_DV;
  if (!url || !key) throw new Error("Faltan credenciales de Supabase.");
  if (!rucEmisor || !dvEmisor) throw new Error("Falta el RUC/DV del emisor.");
  if (url.includes("uqmmkklbhzxqybljiecs")) throw new Error("ABORTADO: apunta a PRODUCCIÓN.");

  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: usuario } = await db
    .from("users").select("id").eq("tenant_id", TENANT).limit(1).maybeSingle();
  const userId = String(usuario?.id ?? "");

  anotar("═".repeat(78));
  anotar("9C — ¿la DGI libera el monto al anular una nota de crédito?");
  anotar(`fecha: ${new Date().toISOString()}`);
  anotar("═".repeat(78));

  // ── Insumos: cliente activo, servicio HON con cuenta activa, ITBMS ────────
  const { data: cliente } = await db
    .from("clients").select("id, name, tax_id, ruc, digito_verificador")
    .eq("tenant_id", TENANT).eq("client_status", "active")
    .not("tax_id", "is", null).order("created_at").limit(1).maybeSingle();
  const { data: servicios } = await db
    .from("services_catalog").select("id, code, name, revenue_account")
    .eq("tenant_id", TENANT).eq("active", true);
  const { data: activas } = await db
    .from("chart_of_accounts").select("code").eq("tenant_id", TENANT).eq("active", true);
  const codes = new Set(((activas ?? []) as { code: string }[]).map((a) => a.code));
  const servicio = ((servicios ?? []) as { id: string; code: string; name: string; revenue_account: string | null }[])
    .find((sv) => sv.code.startsWith("HON") && sv.revenue_account && codes.has(sv.revenue_account));
  const { data: tax } = await db
    .from("tax_codes").select("id, code, rate").eq("tenant_id", TENANT).eq("code", "ITBMS_7").maybeSingle();

  if (!cliente || !servicio || !tax) {
    throw new Error("Faltan insumos (cliente activo, servicio HON con cuenta activa, o ITBMS_7).");
  }

  const clienteId = String(cliente.id);
  const original = {
    tax_id: (cliente as Record<string, unknown>).tax_id,
    ruc: (cliente as Record<string, unknown>).ruc,
    digito_verificador: (cliente as Record<string, unknown>).digito_verificador,
  };

  try {
    await db.from("clients")
      .update({ tax_id: rucEmisor, ruc: rucEmisor, digito_verificador: dvEmisor })
      .eq("id", clienteId);
    anotar("\ncliente apuntado al RUC/DV del emisor (las tres columnas)");

    // ══════════════════════════════════════════════════════════════════════
    // [1] Factura nueva de B/. 10.00 (sin ITBMS: 10.00 exactos, más fácil de
    //     comparar contra el tope)
    // ══════════════════════════════════════════════════════════════════════
    const t = tax as { id: string; code: string; rate: number | string };
    const creada = await createInvoice(db as never, TENANT, userId, {
      invoice_kind: "HONORARIOS",
      client_id: clienteId,
      case_id: null,
      issue_date: hoy,
      due_date: hoy,
      notes: "Prueba 9C — tope [1717] de la DGI",
      lines: [
        {
          service_id: servicio.id,
          description: "Prueba 9C — tope de la DGI",
          quantity: 1,
          unit_price: 10,
          tax_code_id: t.id,
          tax_code: t.code,
          tax_rate: 0,
        },
      ],
    } as never);
    const facturaId = String((creada as { id: string }).id);
    await emitInvoice(db as never, TENANT, facturaId, db as never, userId);

    const { data: facRow } = await db
      .from("invoices").select("invoice_number, grand_total").eq("id", facturaId).maybeSingle();
    const facNro = String((facRow as { invoice_number: string }).invoice_number);
    anotar(`\n[1] factura creada y emitida: ${facNro} · B/. ${(facRow as { grand_total: number }).grand_total}`);

    confirmarAmbiente("emision-factura");
    const emitida = await emitInvoiceToEfactura(db as never, TENANT, userId, facturaId);
    if (emitida.feEstado !== "authorized" || !emitida.cufe) {
      volcar("La factura NO autorizó — no se puede seguir", emitida);
      return;
    }
    anotar(`    ✅ autorizada · CUFE ${emitida.cufe}`);

    const { data: lineas } = await db
      .from("invoice_lines").select("id").eq("invoice_id", facturaId).order("line_order");
    const lineaId = String(((lineas ?? []) as { id: string }[])[0].id);

    // ══════════════════════════════════════════════════════════════════════
    // [2] NC #1 de B/. 10.00, contabilizada y emitida a la DGI
    // ══════════════════════════════════════════════════════════════════════
    const nc1 = await emitCreditNote(db as never, db as never, TENANT, userId, {
      invoice_id: facturaId,
      reason: "Prueba 9C — primera nota de crédito, para anularla después",
      observations: null,
      lineas: [{ invoice_line_id: lineaId, quantity: 1 }],
    });
    anotar(`\n[2] ${nc1.credit_note_number} creada y contabilizada · B/. ${nc1.total}`);

    confirmarAmbiente("emision-nc1");
    const envio1 = await emitCreditNoteToEfactura(db as never, TENANT, userId, nc1.id);
    anotar(`    ${envio1.ok ? "✅ AUTORIZÓ" : "❌ " + (envio1.errorKind ?? "")} · ${envio1.puntoFacturacion}-${envio1.numeroDocumento}`);
    if (!envio1.ok || !envio1.cufe) {
      volcar("La NC #1 no autorizó — no se puede medir el tope", envio1);
      return;
    }
    anotar(`    CUFE de la NC: ${envio1.cufe}`);

    // ══════════════════════════════════════════════════════════════════════
    // [3] Anular la NC #1 ANTE LA DGI
    // ══════════════════════════════════════════════════════════════════════
    confirmarAmbiente("anulacion-nc1-en-dgi");
    anotar("→ POST /api/v1/InvoiceEvents/CreateCancellation  (CUFE de la NC)");
    const crudoAnulacion = await anularEnPac({
      cufe: envio1.cufe,
      cancellationReason: "Prueba 9C — anulación de la nota de crédito para medir el tope",
    });
    volcar("RESPUESTA CRUDA de CreateCancellation (NC)", crudoAnulacion);
    const clasificada = clasificarRespuestaDeAnulacion(crudoAnulacion);
    anotar(`\n[3] anulación de la NC ante la DGI: ${clasificada.clase}`);

    if (clasificada.clase !== "anulada" && clasificada.clase !== "ya_anulada") {
      volcar("La DGI NO anuló la NC — no se puede medir el tope", clasificada);
      return;
    }
    await db.from("credit_notes").update({ fe_estado: "canceled" }).eq("id", nc1.id);
    anotar("    ✅ anulada ante la DGI · fe_estado = canceled");

    // ══════════════════════════════════════════════════════════════════════
    // [4] Reversarla en el libro: `credited_total` vuelve a 0
    // ══════════════════════════════════════════════════════════════════════
    const rev = await reverseCreditNote(
      db as never, db as never, TENANT, userId, nc1.id,
      "Prueba 9C — reversión para volver a acreditar"
    );
    anotar(
      `\n[4] reversada en el libro · asiento ${rev.entry_number} revierte al ${rev.reversed_entry_number}` +
        ` · acreditado de la factura = ${rev.invoice.credited_total} · saldo = ${rev.invoice.balance_due}`
    );
    if (Number(rev.invoice.credited_total) !== 0) {
      anotar("    ⚠️ el acreditado no volvió a 0: la NC #2 la va a rechazar NUESTRO tope, no el de la DGI");
    }

    // ══════════════════════════════════════════════════════════════════════
    // [5] 🔴 LA PREGUNTA: otra NC de B/. 10.00 sobre la MISMA factura
    // ══════════════════════════════════════════════════════════════════════
    const nc2 = await emitCreditNote(db as never, db as never, TENANT, userId, {
      invoice_id: facturaId,
      reason: "Prueba 9C — segunda nota de crédito, después de anular la primera",
      observations: null,
      lineas: [{ invoice_line_id: lineaId, quantity: 1 }],
    });
    anotar(`\n[5] ${nc2.credit_note_number} creada y contabilizada · B/. ${nc2.total}`);

    confirmarAmbiente("emision-nc2");
    const envio2 = await emitCreditNoteToEfactura(db as never, TENANT, userId, nc2.id);
    volcar("RESULTADO de la NC #2", envio2);

    anotar("\n" + "═".repeat(78));
    anotar("VEREDICTO");
    if (envio2.ok) {
      anotar("  ✅ LA DGI AUTORIZÓ LA SEGUNDA NC.");
      anotar("     ⇒ La DGI LIBERA el monto al anular una nota de crédito.");
      anotar("     ⇒ Su tope y nuestro `credited_total` coinciden. No hay que cambiar nada.");
    } else {
      const es1717 = (envio2.mensaje ?? "").includes("1717");
      anotar(`  ❌ LA DGI RECHAZÓ LA SEGUNDA NC${es1717 ? " CON [1717]" : ""}.`);
      anotar(`     «${(envio2.mensaje ?? "").slice(0, 220)}»`);
      if (es1717) {
        anotar("     ⇒ La DGI NO libera el monto: una NC anulada SIGUE contando en su cuenta.");
        anotar("     ⇒ Nuestro tope tiene que contar también las NC fiscales anuladas,");
        anotar("       ANTES de emitir, y la pantalla tiene que explicarlo.");
      }
    }
    anotar("═".repeat(78));

    // ── Fixtures ──────────────────────────────────────────────────────────
    const fixtures = resolve(__dirname, "../../src/lib/finanzas/efactura/__tests__");
    writeFileSync(
      resolve(fixtures, "tope-dgi-anulacion-nc.json"),
      JSON.stringify(
        {
          _que_es: "Respuesta de CreateCancellation al anular una NOTA DE CRÉDITO ante la DGI",
          _medido: new Date().toISOString(),
          _clasificada: clasificada.clase,
          respuesta: crudoAnulacion,
        },
        null,
        2
      ),
      "utf8"
    );
    writeFileSync(
      resolve(fixtures, "tope-dgi-segunda-nc.json"),
      JSON.stringify(
        {
          _que_es:
            "Resultado de emitir una SEGUNDA nota de crédito por el total, después de anular la primera ante la DGI",
          _medido: new Date().toISOString(),
          _autorizada: envio2.ok,
          _libera_el_monto: envio2.ok,
          resultado: envio2,
        },
        null,
        2
      ),
      "utf8"
    );
    anotar("\n📌 fixtures guardados en src/lib/finanzas/efactura/__tests__/");
  } finally {
    const { error } = await db.from("clients").update(original).eq("id", clienteId);
    anotar(error ? `\n🔴 NO SE PUDO RESTAURAR EL CLIENTE: ${error.message}` : "\n✅ cliente restaurado");
    const salida = resolve(__dirname, "../../docs/efactura/prueba9c-tope-1717.txt");
    writeFileSync(salida, informe.join("\n"), "utf8");
    console.log(`\n📄 informe: ${salida}`);
  }
}

main().catch((err) => {
  console.error("\n❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
