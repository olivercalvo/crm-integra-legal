/**
 * BLOQUE 9C — S5 y S8, las dos pruebas que pueden CAMBIAR EL ALCANCE.
 *
 *   npx tsx scripts/efactura/prueba9c-s5-s8.ts <invoice_id_ya_autorizada>
 *
 * **S5 — ¿el `tipoDocumento` 06 es la nota de crédito genérica?**
 *   El swagger acepta `06` en el patrón `01|02|…|10` pero **no le pone nombre a
 *   ninguno de los diez**, y `types/catalogs.ts` sólo declara seis. ideati
 *   recomendó "nota de crédito genérica" para facturas sin CUFE, sin decir cuál
 *   es. Se manda un documento `06` referenciando por `numeroFacturaPapel` y se
 *   mira qué contesta. Si rechaza, el código del rechazo es lo que se le manda
 *   a ideati — preguntar con un código en la mano es otra conversación.
 *
 * **S8 — ¿se puede referenciar un documento de OTRO punto de facturación?**
 *   Es el caso de las facturas de antes de julio, emitidas a mano en el portal
 *   por el punto `050`, que se acreditarían desde el `051`. Si la DGI no lo
 *   acepta, esas facturas no se pueden acreditar desde el CRM y hay que ir al
 *   portal — o sea que **S8 puede tumbar el caso B entero**.
 *
 *   Se prueba en dos pasos: emitir una factura desde un punto distinto del
 *   habitual, y después mandar una NC desde el punto habitual que la
 *   referencie.
 *
 *   ⚠️ Si el punto alternativo no está registrado en el sandbox, el rechazo va
 *      a ser por eso y NO por el cruce de puntos. El script lo dice.
 *
 * 🔴 Cliente apuntado al RUC/DV del emisor, restaurado en un `finally`.
 * 🔴 `i_amb = 2` impreso y verificado antes de cada llamada.
 */
import * as dotenv from "dotenv";
import { resolve } from "path";
import { writeFileSync } from "fs";

dotenv.config({ path: resolve(__dirname, "../../.env.local") });

import { createClient } from "@supabase/supabase-js";
import { mapInvoiceToEfacturaRequest } from "../../src/lib/finanzas/efactura/mapper/map-invoice";
import { fetchInvoiceEfacturaBundle } from "../../src/lib/finanzas/efactura/data/fetch-invoice-efactura-bundle";
import { loadEmisorConfig } from "../../src/lib/finanzas/efactura/config/emisor-config";
import { allocateFeNumero } from "../../src/lib/finanzas/efactura/secuencias/allocate-fe-numero";
import { post } from "../../src/lib/finanzas/efactura/transport/efactura-client";
import { toPanamaIso } from "../../src/lib/finanzas/efactura/mapper/format-decimals";
import type { TipoDocumento } from "../../src/lib/finanzas/efactura/types/catalogs";

const INVOICE_ID = process.argv[2];
/** Un punto distinto del habitual, para el cruce de S8. */
const PUNTO_ALTERNATIVO = process.argv[3] ?? "002";

const informe: string[] = [];
const anotar = (l: string) => {
  console.log(l);
  informe.push(l);
};
const volcar = (t: string, v: unknown) => {
  anotar(`\n${t}:`);
  anotar(JSON.stringify(v, null, 2));
};

function confirmarAmbiente(paso: string) {
  const iAmb = process.env.EFACTURA_I_AMB;
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV;
  anotar(`\n🔒 [${paso}] AMBIENTE: EFACTURA_I_AMB = ${iAmb} · NEXT_PUBLIC_APP_ENV = ${appEnv}`);
  if (iAmb !== "2") throw new Error(`ABORTADO: EFACTURA_I_AMB = ${iAmb}. Sólo sandbox (2).`);
  if (appEnv === "production") throw new Error("ABORTADO: appEnv = production.");
}

/** Los códigos que devolvió el PAC, aplanados para leerlos de un vistazo. */
function codigos(r: unknown): string {
  const o = r as Record<string, unknown>;
  const g = (o?.rRetEnviFe as Record<string, unknown>)?.xProtFe as Record<string, unknown>;
  const lista = ((g?.rProtFe as Record<string, unknown>)?.gInfProt as Record<string, unknown>)
    ?.gResProc as Array<{ dCodRes?: string; dMsgRes?: string }> | undefined;
  if (!Array.isArray(lista) || lista.length === 0) return "(sin códigos)";
  return lista.map((c) => `[${c.dCodRes}] ${c.dMsgRes}`).join(" · ");
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const rucEmisor = process.env.EFACTURA_EMISOR_RUC;
  const dvEmisor = process.env.EFACTURA_EMISOR_DV;
  const razonEmisor = process.env.EFACTURA_EMISOR_RAZON_SOCIAL;
  if (!url || !key || !rucEmisor || !dvEmisor || !razonEmisor) {
    throw new Error("Faltan credenciales o datos del emisor en .env.local");
  }
  if (!INVOICE_ID) throw new Error("Falta el invoice_id.");

  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: inv } = await db
    .from("invoices")
    .select("id, tenant_id, invoice_number, client_id, issue_date, fe_estado, dgi_cufe")
    .eq("id", INVOICE_ID)
    .maybeSingle();
  if (!inv) throw new Error("No existe esa factura.");
  if (!inv.dgi_cufe) throw new Error("Esa factura no tiene CUFE: hace falta una autorizada.");

  const { data: cli } = await db
    .from("clients")
    .select("id, name, tax_id, ruc, digito_verificador")
    .eq("id", inv.client_id)
    .maybeSingle();
  if (!cli) throw new Error("No existe el cliente.");

  const original = {
    tax_id: cli.tax_id,
    ruc: cli.ruc,
    digito_verificador: cli.digito_verificador,
  };

  anotar("═".repeat(78));
  anotar("9C — S5 (¿el 06 es la NC genérica?) y S8 (¿se cruza de punto?)");
  anotar(`fecha:   ${new Date().toISOString()}`);
  anotar(`factura: ${inv.invoice_number} · CUFE ${inv.dgi_cufe}`);
  anotar("═".repeat(78));

  const emisor = loadEmisorConfig();
  const tenantId = String(inv.tenant_id);

  try {
    await db
      .from("clients")
      .update({ tax_id: rucEmisor, ruc: rucEmisor, digito_verificador: dvEmisor })
      .eq("id", cli.id);
    anotar("\ncliente apuntado al RUC/DV del emisor (las tres columnas)");

    const bundle = await fetchInvoiceEfacturaBundle(db as never, tenantId, String(inv.id));

    /** Manda un documento y devuelve si autorizó, con sus códigos. */
    const mandar = async (
      nombre: string,
      tipoDocumento: string,
      punto: string,
      referencia: unknown | null
    ) => {
      const numero = await allocateFeNumero(db as never, {
        tenantId,
        puntoFacturacion: emisor.puntoFacturacion,
      });
      const base = mapInvoiceToEfacturaRequest({
        bundle,
        emisor,
        sequence: { puntoFacturacion: punto, numeroDocumento: numero },
        options: {
          iAmb: emisor.iAmb,
          // `06` no está declarado en el catálogo del repo: es justamente lo
          // que esta prueba viene a averiguar.
          tipoDocumento: tipoDocumento as TipoDocumento,
          fechaEmision: new Date(),
        },
      });
      const payload = referencia
        ? {
            ...base,
            datosGenerales: {
              ...base.datosGenerales,
              documentosFiscalesReferenciados: referencia,
            },
          }
        : base;

      confirmarAmbiente(nombre);
      anotar(`→ POST /api/v1/Invoices · tipoDocumento=${tipoDocumento} · punto=${punto} · nº ${numero}`);
      try {
        const r = await post("/api/v1/Invoices?qr=true&xml=false", payload);
        const o = r as Record<string, unknown>;
        const ok = o.autorizada === true;
        anotar(`${ok ? "✅ AUTORIZÓ" : "❌ no autorizó"} · ${codigos(r)}`);
        volcar(`RESPUESTA — ${nombre}`, r);
        return { ok, crudo: r, cufe: typeof o.cufe === "string" ? o.cufe : null };
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        anotar(`❌ LANZÓ — ${m.slice(0, 400)}`);
        return { ok: false, crudo: { error: m }, cufe: null };
      }
    };

    const refEmisor = {
      tipoRuc: emisor.tipoContribuyente,
      ruc: emisor.ruc,
      digitoVerificador: emisor.digitoVerificador,
    };
    const fechaRef = toPanamaIso(String(inv.issue_date));

    // ── S5 — tipoDocumento 06 con referencia a factura en PAPEL ────────────
    anotar("\n" + "─".repeat(78));
    anotar("S5 — ¿el tipoDocumento 06 es la nota de crédito genérica?");
    anotar("─".repeat(78));
    const s5 = await mandar("S5-tipo-06-papel", "06", emisor.puntoFacturacion, [
      {
        rucEmisorDocumentoReferenciado: refEmisor,
        nombreRazonSocialEmisor: razonEmisor,
        fechaEmisionDocumentoReferenciado: fechaRef,
        informacionReferencia: {
          informacionReferenciaFacturaPapel: { numeroFacturaPapel: "FAC-PAPEL-000123" },
        },
      },
    ]);

    // ── S5b — DESAMBIGUAR: ¿fue el tipo 06 o fue la referencia a papel? ────
    //    S5 mezcló DOS novedades a la vez. Si el `04` con referencia a papel
    //    autoriza, entonces las facturas en papel SÍ se pueden acreditar y el
    //    problema es sólo el tipo `06`.
    anotar("\n" + "─".repeat(78));
    anotar("S5b — tipoDocumento 04 con referencia a factura en PAPEL");
    anotar("─".repeat(78));
    const s5b = await mandar("S5b-tipo-04-papel", "04", emisor.puntoFacturacion, [
      {
        rucEmisorDocumentoReferenciado: refEmisor,
        nombreRazonSocialEmisor: razonEmisor,
        fechaEmisionDocumentoReferenciado: fechaRef,
        informacionReferencia: {
          informacionReferenciaFacturaPapel: { numeroFacturaPapel: "FAC-PAPEL-000123" },
        },
      },
    ]);

    // ── S8 — paso 1: una factura desde OTRO punto ──────────────────────────
    anotar("\n" + "─".repeat(78));
    anotar(`S8 — ¿se puede referenciar un documento de otro punto? (paso 1: emitir desde ${PUNTO_ALTERNATIVO})`);
    anotar("─".repeat(78));
    const s8a = await mandar("S8-factura-otro-punto", "01", PUNTO_ALTERNATIVO, null);

    // ── S8 — paso 2: la NC desde el punto habitual ─────────────────────────
    let s8b: { ok: boolean } | null = null;
    if (s8a.ok && s8a.cufe) {
      anotar("\n" + "─".repeat(78));
      anotar(`S8 — paso 2: NC 04 desde ${emisor.puntoFacturacion} referenciando el CUFE del ${PUNTO_ALTERNATIVO}`);
      anotar("─".repeat(78));
      s8b = await mandar("S8-nc-cruzando-puntos", "04", emisor.puntoFacturacion, [
        {
          rucEmisorDocumentoReferenciado: refEmisor,
          nombreRazonSocialEmisor: razonEmisor,
          fechaEmisionDocumentoReferenciado: toPanamaIso(new Date()),
          informacionReferencia: {
            informacionReferencia: { cufeReferenciado: s8a.cufe },
          },
        },
      ]);
    } else {
      anotar(
        `\n⚠️ S8 NO SE PUDO PROBAR: la factura desde el punto ${PUNTO_ALTERNATIVO} no autorizó, ` +
          `así que no hay un documento de otro punto al que referenciar. ` +
          `Si el motivo es que ese punto no está registrado en el sandbox, el resultado NO dice ` +
          `nada sobre el cruce de puntos.`
      );
    }

    anotar("\n" + "═".repeat(78));
    anotar("VEREDICTO");
    anotar(`  S5  — tipoDocumento 06 con referencia a papel: ${s5.ok ? "✅ AUTORIZÓ" : "❌ no autorizó"}`);
    anotar(`  S5b — tipoDocumento 04 con referencia a papel: ${s5b.ok ? "✅ AUTORIZÓ" : "❌ no autorizó"}`);
    anotar(`  S8 paso 1 — factura desde el punto ${PUNTO_ALTERNATIVO}: ${s8a.ok ? "✅" : "❌"}`);
    anotar(
      `  S8 paso 2 — NC cruzando puntos: ${s8b ? (s8b.ok ? "✅ AUTORIZÓ" : "❌ no autorizó") : "no se pudo probar"}`
    );
    anotar("═".repeat(78));
  } finally {
    const { error } = await db.from("clients").update(original).eq("id", cli.id);
    anotar(error ? `\n🔴 NO SE RESTAURÓ EL CLIENTE: ${error.message}` : "\n✅ cliente restaurado");
    const salida = resolve(__dirname, "../../docs/efactura/prueba9c-s5-s8.txt");
    writeFileSync(salida, informe.join("\n"), "utf8");
    console.log(`\n📄 informe: ${salida}`);
  }
}

main().catch((err) => {
  console.error("\n❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
