/**
 * BLOQUE 9C — ¿CÓMO SE ARMA `documentosFiscalesReferenciados`?
 *
 *   npx tsx scripts/efactura/prueba9c-referencia.ts
 *
 * El swagger dice que `informacionReferencia` está **doblemente anidado**
 * (un wrapper `gDFRefNumRequest` que adentro tiene otro `informacionReferencia`
 * con el `cufeReferenciado`), y las notas del repo lo tenían plano. Las dos
 * cosas no pueden ser ciertas, y **el swagger de ideati ya demostró que no
 * alcanza**: no tiene un solo `required`, ni un `enum`, ni descripciones.
 *
 * Así que no se decide leyendo: se manda **la misma nota de crédito con las dos
 * formas** y queda la que la DGI autorice.
 *
 * ⚠️ NO TOCA EL MAPPER. El payload se arma con `mapInvoiceToEfacturaRequest` y
 *    el bloque de referencia se inyecta acá, a mano, en cada forma. Es a
 *    propósito: la regla de 9A dice que el golden va ANTES del refactor, y para
 *    escribir el golden hay que saber primero cuál es la forma correcta.
 *
 * 🔴 El cliente se apunta al RUC/DV del emisor —único receptor que el sandbox
 *    acepta— y se restaura en un `finally`.
 * 🔴 Imprime y verifica `i_amb = 2` antes de cada llamada.
 *
 * ESCRIBE EN STAGING: emite una factura y quema correlativos del punto.
 */
import * as dotenv from "dotenv";
import { resolve } from "path";
import { writeFileSync } from "fs";

dotenv.config({ path: resolve(__dirname, "../../.env.local") });

import { createClient } from "@supabase/supabase-js";
import { emitInvoiceToEfactura } from "../../src/lib/finanzas/efactura/orchestration/emit-invoice-to-efactura";
import { mapInvoiceToEfacturaRequest } from "../../src/lib/finanzas/efactura/mapper/map-invoice";
import { fetchInvoiceEfacturaBundle } from "../../src/lib/finanzas/efactura/data/fetch-invoice-efactura-bundle";
import { loadEmisorConfig } from "../../src/lib/finanzas/efactura/config/emisor-config";
import { allocateFeNumero } from "../../src/lib/finanzas/efactura/secuencias/allocate-fe-numero";
import { post } from "../../src/lib/finanzas/efactura/transport/efactura-client";
import { toPanamaIso } from "../../src/lib/finanzas/efactura/mapper/format-decimals";

const INVOICE_ID = process.argv[2];

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

/** El emisor referenciado es el bufete: la NC referencia una factura NUESTRA. */
function emisorReferenciado() {
  const e = loadEmisorConfig();
  return {
    tipoRuc: e.tipoContribuyente,
    ruc: e.ruc,
    digitoVerificador: e.digitoVerificador,
  };
}

/** FORMA A — la del swagger: `informacionReferencia` dentro de `informacionReferencia`. */
function referenciaAnidada(cufe: string, fechaEmision: string, razonSocial: string) {
  return [
    {
      rucEmisorDocumentoReferenciado: emisorReferenciado(),
      nombreRazonSocialEmisor: razonSocial,
      fechaEmisionDocumentoReferenciado: fechaEmision,
      informacionReferencia: {
        informacionReferencia: { cufeReferenciado: cufe },
      },
    },
  ];
}

/** FORMA B — la plana, que es como lo tenían las notas del repo. */
function referenciaPlana(cufe: string, fechaEmision: string, razonSocial: string) {
  return [
    {
      rucEmisorDocumentoReferenciado: emisorReferenciado(),
      nombreRazonSocialEmisor: razonSocial,
      fechaEmisionDocumentoReferenciado: fechaEmision,
      informacionReferencia: { cufeReferenciado: cufe },
    },
  ];
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const rucEmisor = process.env.EFACTURA_EMISOR_RUC;
  const dvEmisor = process.env.EFACTURA_EMISOR_DV;
  if (!url || !key) throw new Error("Faltan credenciales de Supabase.");
  if (!rucEmisor || !dvEmisor) throw new Error("Falta el RUC/DV del emisor.");
  if (!INVOICE_ID) throw new Error("Falta el invoice_id (una factura emitida, fe_estado no_emitida|error).");

  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: inv } = await db
    .from("invoices")
    .select("id, tenant_id, invoice_number, client_id, issue_date, fe_estado, dgi_cufe")
    .eq("id", INVOICE_ID)
    .maybeSingle();
  if (!inv) throw new Error("No existe esa factura.");

  const { data: cli } = await db
    .from("clients")
    .select("id, name, tax_id, ruc, digito_verificador")
    .eq("id", inv.client_id)
    .maybeSingle();
  if (!cli) throw new Error("No existe el cliente.");

  const { data: usuario } = await db
    .from("users").select("id").eq("tenant_id", inv.tenant_id).limit(1).maybeSingle();

  const original = {
    tax_id: cli.tax_id,
    ruc: cli.ruc,
    digito_verificador: cli.digito_verificador,
  };

  anotar("═".repeat(78));
  anotar("9C — la forma de `documentosFiscalesReferenciados`");
  anotar(`fecha:   ${new Date().toISOString()}`);
  anotar(`factura: ${inv.invoice_number} (${inv.fe_estado})`);
  anotar("═".repeat(78));

  try {
    await db
      .from("clients")
      .update({ tax_id: rucEmisor, ruc: rucEmisor, digito_verificador: dvEmisor })
      .eq("id", cli.id);
    anotar("\ncliente apuntado al RUC/DV del emisor (las tres columnas)");

    // ── S1: la factura que se va a referenciar ─────────────────────────────
    // Si ya está autorizada (de una corrida anterior) se REUSA su CUFE: el
    // gate T0 rechaza reemitir, y además sería quemar otro correlativo para
    // conseguir exactamente el mismo dato.
    let cufeDeLaFactura: string;
    if (inv.fe_estado === "authorized" && inv.dgi_cufe) {
      cufeDeLaFactura = String(inv.dgi_cufe);
      anotar("\n(la factura ya estaba autorizada: se reusa su CUFE)");
    } else {
      confirmarAmbiente("S1-emision");
      anotar("→ POST /api/v1/Invoices  (la factura a referenciar)\n");
      const emitida = await emitInvoiceToEfactura(
        db as never, String(inv.tenant_id), String(usuario?.id ?? ""), String(inv.id)
      );
      anotar(`fe_estado = ${emitida.feEstado}`);
      if (emitida.feEstado !== "authorized" || !emitida.cufe) {
        volcar("NO autorizó — no se puede seguir", emitida);
        return;
      }
      cufeDeLaFactura = emitida.cufe;
    }
    anotar(`✅ CUFE de la factura: ${cufeDeLaFactura}`);

    // ── El payload base de la NC ───────────────────────────────────────────
    const bundle = await fetchInvoiceEfacturaBundle(db as never, String(inv.tenant_id), String(inv.id));
    const emisor = loadEmisorConfig();
    // 🔴 CON ZONA HORARIA. El primer intento mandó `2026-09-24T00:00:00` pelado
    //    y la DGI lo rechazó con `0100`: "dFechaDFRef ... is invalid according
    //    to its datatype fechaTZ - The Pattern constraint failed". La fecha del
    //    documento referenciado usa el MISMO formato que `fechaEmision`.
    const fechaEmisionOriginal = toPanamaIso(String(inv.issue_date));

    const tenantId = String(inv.tenant_id);
    const mandarNc = async (nombre: string, referencia: unknown) => {
      const numero = await allocateFeNumero(db as never, {
        tenantId,
        puntoFacturacion: emisor.puntoFacturacion,
      });
      const base = mapInvoiceToEfacturaRequest({
        bundle,
        emisor,
        sequence: { puntoFacturacion: emisor.puntoFacturacion, numeroDocumento: numero },
        options: { iAmb: emisor.iAmb, tipoDocumento: "04", fechaEmision: new Date() },
      });
      const payload = {
        ...base,
        datosGenerales: {
          ...base.datosGenerales,
          documentosFiscalesReferenciados: referencia,
        },
      };

      confirmarAmbiente(nombre);
      anotar(`→ POST /api/v1/Invoices  (NC 04, ${nombre}, documento ${numero})`);
      volcar(`documentosFiscalesReferenciados — ${nombre}`, referencia);
      try {
        const r = await post("/api/v1/Invoices?qr=true&xml=false", payload);
        const o = r as Record<string, unknown>;
        anotar(
          `\n🔴 ${nombre}: autorizada = ${String(o.autorizada)} · cufe = ${o.cufe ? "sí" : "no"}`
        );
        volcar(`RESPUESTA — ${nombre}`, r);
        return { nombre, autorizada: o.autorizada === true, crudo: r };
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        anotar(`\n🔴 ${nombre}: la llamada LANZÓ — ${m.slice(0, 300)}`);
        return { nombre, autorizada: false, crudo: { error: m } };
      }
    };

    const a = await mandarNc("FORMA-A-anidada", referenciaAnidada(cufeDeLaFactura, fechaEmisionOriginal, String(cli.name)));
    const b = await mandarNc("FORMA-B-plana", referenciaPlana(cufeDeLaFactura, fechaEmisionOriginal, String(cli.name)));

    anotar("\n" + "═".repeat(78));
    anotar("VEREDICTO");
    anotar(`  FORMA A (anidada, la del swagger): ${a.autorizada ? "✅ AUTORIZÓ" : "❌ no autorizó"}`);
    anotar(`  FORMA B (plana, la de las notas):  ${b.autorizada ? "✅ AUTORIZÓ" : "❌ no autorizó"}`);
    anotar("═".repeat(78));
  } finally {
    const { error } = await db.from("clients").update(original).eq("id", cli.id);
    anotar(error ? `\n🔴 NO SE PUDO RESTAURAR EL CLIENTE: ${error.message}` : "\n✅ cliente restaurado");
    const salida = resolve(__dirname, "../../docs/efactura/prueba9c-referencia.txt");
    writeFileSync(salida, informe.join("\n"), "utf8");
    console.log(`\n📄 informe: ${salida}`);
  }
}

main().catch((err) => {
  console.error("\n❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
