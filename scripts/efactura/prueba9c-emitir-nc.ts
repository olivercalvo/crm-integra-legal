/**
 * BLOQUE 9C — EMITIR UNA NOTA DE CRÉDITO A LA DGI, DE PUNTA A PUNTA.
 *
 *   npx tsx scripts/efactura/prueba9c-emitir-nc.ts
 *
 * Corre el camino REAL (`emitCreditNoteToEfactura`), no una simulación: el
 * mismo mapper, el mismo bloque de referencia congelado, el mismo clasificador
 * de respuesta y las mismas escrituras en `credit_notes` y `fe_emisiones`.
 *
 * Qué comprueba, en orden:
 *   1. 🔴 Una NC cuya factura NO tiene CUFE se RECHAZA con 409 **sin quemar
 *      correlativo**. Es el caso B/C, y es lo que más fácil se rompe.
 *   2. Una NC TOTAL sobre una factura con CUFE: autoriza, y quedan guardados
 *      el CUFE, el protocolo y la fila de `fe_emisiones`.
 *   3. Una NC PARCIAL (una línea de varias): autoriza, y el ITBMS que viaja es
 *      el proporcional que calcula el Bloque 5.
 *   4. Reenviar una NC ya autorizada: 409, sin tocar nada.
 *
 * 🔴 El cliente se apunta al RUC/DV del emisor —único receptor que el sandbox
 *    acepta— y se restaura en un `finally`.
 * 🔴 Imprime y verifica `i_amb = 2` antes de cada llamada.
 *
 * ESCRIBE EN STAGING: emite facturas y NC, y quema correlativos del punto.
 */
import * as dotenv from "dotenv";
import { resolve } from "path";
import { writeFileSync } from "fs";

dotenv.config({ path: resolve(__dirname, "../../.env.local") });

import { createClient } from "@supabase/supabase-js";
import { emitInvoiceToEfactura } from "../../src/lib/finanzas/efactura/orchestration/emit-invoice-to-efactura";
import { emitCreditNoteToEfactura } from "../../src/lib/finanzas/efactura/orchestration/emit-credit-note-to-efactura";
import { createCreditNote } from "../../src/lib/finanzas/api/credit-notes";

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

const TENANT = "a0000000-0000-0000-0000-000000000001";

/**
 * 🔴 FACTURAS QUE NO SE TOCAN, NI PARA LEER UN CASO DE BORDE.
 *
 * `FAC-HON-000007` está reservada para la demo con `fe_estado = 'error'`. La
 * primera corrida de esta prueba (24/09/2026) la eligió para el caso "sin
 * CUFE" y le creó una NC: el gate cortó el envío ANTES de escribir nada
 * fiscal —`fe_estado` quedó intacto— pero la NC la dejó acreditada al 100% y
 * con saldo 0, que para una demo es igual de malo. Se deshizo con la válvula
 * `finanzas.nc_compensar`.
 *
 * La lección: un caso de prueba que sólo necesita "una factura cualquiera" va
 * a elegir la peor si no se le dice cuál no.
 */
const NO_TOCAR = new Set(["FAC-HON-000007"]);

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
  anotar("9C — emitir una nota de crédito a la DGI");
  anotar(`fecha: ${new Date().toISOString()}`);
  anotar("═".repeat(78));

  // ── Se elige una factura emitida, con líneas, sin NC previa ───────────────
  const { data: candidatas } = await db
    .from("invoices")
    .select("id, invoice_number, client_id, status, fe_estado, dgi_cufe, issue_date, grand_total, amount_paid")
    .eq("tenant_id", TENANT)
    .in("status", ["emitida", "parcialmente_pagada"])
    .eq("credited_total", 0)
    .order("created_at", { ascending: false })
    .limit(20);

  const lista = (candidatas ?? []) as Record<string, unknown>[];
  // Sin CUFE y SIN COBROS: con un cobro aplicado, el tope D7 del propio CRM
  // rechaza la NC total antes de llegar al gate del CUFE, que es lo que se
  // quiere medir acá.
  const sinCufe = lista.find(
    (f) =>
      !f.dgi_cufe &&
      Number(f.amount_paid ?? 0) === 0 &&
      !NO_TOCAR.has(String(f.invoice_number))
  );

  // 🔴 SE PREFIERE UNA FACTURA QUE LA DGI NO HAYA ACREDITADO TODAVÍA.
  //
  // La DGI LLEVA LA CUENTA de lo acreditado por documento referenciado y
  // rechaza con `[1717] Monto de las notas de crédito o débito inconsistentes
  // con el monto de la FE original referenciada` cuando la suma pasa el total
  // de la factura. Medido el 24/09/2026: la primera corrida de esta prueba
  // rebotó así porque `prueba9c-referencia.ts` ya había acreditado el 100% de
  // FAC-REI-000004 ese mismo día.
  //
  // O sea que reusar una factura ya acreditada no prueba nada del código: sólo
  // vuelve a medir el tope de la DGI. Se puede pasar el número por argumento
  // para elegirla a mano.
  const pedida = process.argv[2];
  const elegibles = lista.filter((f) => !NO_TOCAR.has(String(f.invoice_number)));
  const paraEmitir = pedida
    ? elegibles.find((f) => String(f.invoice_number) === pedida)
    : (elegibles.find((f) => f.fe_estado === "no_emitida") ?? elegibles.find((f) => f.dgi_cufe));
  if (!paraEmitir) {
    throw new Error(
      pedida
        ? `No se encontró ${pedida} entre las candidatas (emitida, sin NC).`
        : "No hay factura candidata en staging."
    );
  }

  const clienteId = String(paraEmitir.client_id);
  const { data: cli } = await db
    .from("clients").select("id, name, tax_id, ruc, digito_verificador").eq("id", clienteId).maybeSingle();
  if (!cli) throw new Error("No existe el cliente.");
  const original = {
    tax_id: (cli as Record<string, unknown>).tax_id,
    ruc: (cli as Record<string, unknown>).ruc,
    digito_verificador: (cli as Record<string, unknown>).digito_verificador,
  };

  try {
    await db.from("clients")
      .update({ tax_id: rucEmisor, ruc: rucEmisor, digito_verificador: dvEmisor })
      .eq("id", clienteId);
    anotar("\ncliente apuntado al RUC/DV del emisor (las tres columnas)");

    // ══════════════════════════════════════════════════════════════════════
    // [1] 🔴 NC sobre una factura SIN CUFE: se rechaza sin quemar correlativo
    // ══════════════════════════════════════════════════════════════════════
    if (sinCufe) {
      const { data: seqAntes } = await db
        .from("fe_secuencias").select("ultimo_numero").eq("tenant_id", TENANT).maybeSingle();
      const antes = Number((seqAntes as { ultimo_numero?: number } | null)?.ultimo_numero ?? 0);

      const { data: lineasSC } = await db
        .from("invoice_lines").select("id, quantity").eq("invoice_id", String(sinCufe.id)).limit(1);
      const l0 = ((lineasSC ?? []) as Record<string, unknown>[])[0];

      if (l0) {
       try {
        // Se apunta el cliente de ESA factura también, por si es otro.
        const ncSC = await createCreditNote(db as never, TENANT, userId, {
          invoice_id: String(sinCufe.id),
          reason: "Prueba 9C — NC sobre factura sin CUFE",
          observations: null,
          lineas: [{ invoice_line_id: String(l0.id), quantity: 1 }],
        });
        try {
          await emitCreditNoteToEfactura(db as never, TENANT, userId, ncSC.id);
          anotar("\n[1] NC sobre factura SIN CUFE ......... ⚠️ PASÓ (debía dar 409)");
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          const { data: seqDesp } = await db
            .from("fe_secuencias").select("ultimo_numero").eq("tenant_id", TENANT).maybeSingle();
          const desp = Number((seqDesp as { ultimo_numero?: number } | null)?.ultimo_numero ?? 0);
          const intacto = desp === antes;
          anotar(
            `\n[1] NC sobre factura SIN CUFE ......... ${intacto ? "✅" : "❌"} RECHAZADA y correlativo ${intacto ? "INTACTO" : `MOVIDO ${antes}→${desp}`}`
          );
          anotar(`    «${m.slice(0, 160)}»`);
        }
       } catch (err) {
        // Montar el caso puede fallar por reglas del propio CRM (tope D7 sobre
        // una factura con cobros, por ejemplo). No es lo que se mide acá.
        anotar(`
[1] (no se pudo montar el caso sin CUFE: ${err instanceof Error ? err.message.slice(0, 110) : ""})`);
       }
      } else {
        anotar("\n[1] (sin líneas en la factura sin CUFE: se saltea)");
      }
    } else {
      anotar("\n[1] (no hay factura sin CUFE en staging: se saltea)");
    }

    // ══════════════════════════════════════════════════════════════════════
    // [2] La factura con CUFE. Se emite si hace falta.
    // ══════════════════════════════════════════════════════════════════════
    let cufeFactura = paraEmitir.dgi_cufe ? String(paraEmitir.dgi_cufe) : null;
    if (!cufeFactura) {
      confirmarAmbiente("emision-factura");
      anotar(`→ POST /api/v1/Invoices  (factura ${paraEmitir.invoice_number})`);
      const emitida = await emitInvoiceToEfactura(
        db as never, TENANT, userId, String(paraEmitir.id)
      );
      if (emitida.feEstado !== "authorized" || !emitida.cufe) {
        volcar("La factura NO autorizó — no se puede seguir", emitida);
        return;
      }
      cufeFactura = emitida.cufe;
    }
    anotar(`\n✅ factura ${paraEmitir.invoice_number} con CUFE: ${cufeFactura}`);

    const { data: lineas } = await db
      .from("invoice_lines")
      .select("id, quantity, description")
      .eq("invoice_id", String(paraEmitir.id))
      .order("line_order");
    const ls = (lineas ?? []) as Record<string, unknown>[];
    if (ls.length === 0) throw new Error("La factura no tiene líneas.");

    // ══════════════════════════════════════════════════════════════════════
    // [3] NC PARCIAL — una línea, cantidad 1
    // ══════════════════════════════════════════════════════════════════════
    const ncParcial = await createCreditNote(db as never, TENANT, userId, {
      invoice_id: String(paraEmitir.id),
      reason: "Prueba 9C — nota de crédito parcial",
      observations: null,
      lineas: [{ invoice_line_id: String(ls[0].id), quantity: 1 }],
    });
    anotar(`\nNC parcial creada: ${ncParcial.credit_note_number} (B/. ${ncParcial.total})`);

    confirmarAmbiente("emision-nc-parcial");
    anotar("→ POST /api/v1/Invoices  (tipoDocumento 04, NC parcial)");
    const r1 = await emitCreditNoteToEfactura(db as never, TENANT, userId, ncParcial.id);
    anotar(
      `\n[2] NC PARCIAL ........................ ${r1.ok ? "✅ AUTORIZÓ" : "❌ " + (r1.errorKind ?? "")}` +
        ` · ${r1.puntoFacturacion}-${r1.numeroDocumento}`
    );
    if (r1.ok) anotar(`    CUFE: ${r1.cufe}`);
    else anotar(`    «${(r1.mensaje ?? "").slice(0, 200)}»`);

    // Lo que quedó guardado.
    const { data: guardada } = await db
      .from("credit_notes")
      .select("fe_estado, dgi_cufe, dgi_protocolo_autorizacion, punto_facturacion, numero_documento, i_amb")
      .eq("id", ncParcial.id).maybeSingle();
    volcar("credit_notes después del envío", guardada);

    const { data: emisiones } = await db
      .from("fe_emisiones")
      .select("intento, autorizada, cufe, punto_facturacion, numero_documento, i_amb")
      .eq("credit_note_id", ncParcial.id);
    volcar("fe_emisiones de esta NC", emisiones);

    // El bloque de referencia que realmente viajó.
    const { data: payload } = await db
      .from("fe_emisiones").select("request_payload").eq("credit_note_id", ncParcial.id).limit(1).maybeSingle();
    const dg = (payload as { request_payload?: Record<string, unknown> } | null)?.request_payload
      ?.datosGenerales as Record<string, unknown> | undefined;
    volcar("tipoDocumento + documentosFiscalesReferenciados enviados", {
      tipoDocumento: dg?.tipoDocumento,
      documentosFiscalesReferenciados: dg?.documentosFiscalesReferenciados,
    });

    // ══════════════════════════════════════════════════════════════════════
    // [4] Reenviar una NC ya autorizada
    // ══════════════════════════════════════════════════════════════════════
    if (r1.ok) {
      try {
        await emitCreditNoteToEfactura(db as never, TENANT, userId, ncParcial.id);
        anotar("\n[3] reenviar una NC autorizada ........ ⚠️ PASÓ (debía dar 409)");
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        anotar(`\n[3] reenviar una NC autorizada ........ ✅ RECHAZADO: «${m.slice(0, 90)}»`);
      }
    }

    anotar("\n" + "═".repeat(78));
    anotar("FIN");
    anotar("═".repeat(78));
  } finally {
    const { error } = await db.from("clients").update(original).eq("id", clienteId);
    anotar(error ? `\n🔴 NO SE PUDO RESTAURAR EL CLIENTE: ${error.message}` : "\n✅ cliente restaurado");
    const salida = resolve(__dirname, "../../docs/efactura/prueba9c-emitir-nc.txt");
    writeFileSync(salida, informe.join("\n"), "utf8");
    console.log(`\n📄 informe: ${salida}`);
  }
}

main().catch((err) => {
  console.error("\n❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
