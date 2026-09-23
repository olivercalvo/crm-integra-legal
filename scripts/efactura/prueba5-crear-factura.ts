/**
 * PRUEBA 5, PASO 1 — crear en staging la factura con la que se va a medir la
 * respuesta exitosa de `CreateCancellation`.
 *
 *   npx tsx scripts/efactura/prueba5-crear-factura.ts
 *
 * ¿Por qué hace falta una factura nueva? Porque el único documento autorizado
 * que había en staging ya tenía un evento de anulación encima, y el PAC no
 * tiene endpoint para listar eventos: no hay forma de saber si ese evento lo
 * creamos nosotros. Un documento limpio saca la duda del medio.
 *
 * 🔴 EL CLIENTE NO ES CUALQUIERA. Los RUC del seed son ficticios y la DGI los
 *    rechaza (`1601` / `1602`). El único de staging que el sandbox aceptó es el
 *    de **CONSTRUCTORA CHIRIQUÍ ANTIGUO, S.A.** (`1499876-1-690042`), que es el
 *    de la factura autorizada del 17/09. Por eso la factura se crea para ese
 *    cliente y no para otro.
 *
 * Monto bajo y una sola línea: lo que se va a medir es la forma de la respuesta
 * del PAC, no la aritmética.
 *
 * Deja la factura **emitida** (con su número y su asiento). Enviarla al PAC y
 * anularla son los pasos siguientes, y van por la pantalla.
 *
 * ESCRIBE EN STAGING. No toca el PAC: acá no hay ninguna llamada al sandbox.
 */
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../../.env.local") });

import { createClient } from "@supabase/supabase-js";
import { createInvoice, emitInvoice } from "../../src/lib/finanzas/api/invoices";

const RUC_QUE_EL_SANDBOX_ACEPTA = "1499876-1-690042";

/**
 * 🔴 La línea NECESITA un servicio del catálogo. `emitInvoice` no postea sin él:
 * sin servicio no sabe a qué cuenta de ingreso va la línea y aborta con
 * "no tiene un servicio del catálogo que diga a qué cuenta de ingreso va".
 * Una línea "personalizada" (`service_id: null`) se puede guardar en un
 * borrador, pero no se puede emitir.
 */
const SERVICIO = process.argv[2] ?? "REIM-GOB";

/**
 * 🔴 REEMBOLSO Y NO HONORARIOS, Y NO ES UN DETALLE.
 *
 * Medido el 23/09/2026: la MISMA factura, para el MISMO cliente y con el MISMO
 * RUC, la DGI la rechaza como `tipoDocumento 01` (`1601` "Regla de formación
 * del RUC invalida" + `1602` "RUC inexistente") y la aceptó como `09` — que es
 * lo que es `FAC-REI-000002`, la única autorizada de staging.
 *
 * O sea que el sandbox **valida el RUC del receptor en el tipo 01 y no en el
 * 09**, y los RUC del seed son ficticios. Con `01` no hay forma de emitir desde
 * staging sin un RUC panameño real.
 */
const KIND: "HONORARIOS" | "REEMBOLSO" = SERVICIO.startsWith("REIM") ? "REEMBOLSO" : "HONORARIOS";

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

function enDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV;
  if (!url || !key) throw new Error("Faltan credenciales de Supabase en .env.local");
  if (appEnv === "production") throw new Error("ABORTADO: appEnv = production.");
  console.log(`\n🔒 AMBIENTE: NEXT_PUBLIC_APP_ENV = ${appEnv}  ·  proyecto = ${url.slice(8, 28)}…`);

  const db = createClient(url, key, { auth: { persistSession: false } });

  // ── El cliente, buscado por el RUC que sabemos que pasa ───────────────────
  const { data: cliente, error: errCli } = await db
    .from("clients")
    .select("id, tenant_id, name, tax_id, client_status")
    .eq("tax_id", RUC_QUE_EL_SANDBOX_ACEPTA)
    .maybeSingle();
  if (errCli) throw new Error(errCli.message);
  if (!cliente) throw new Error(`No hay ningún cliente con RUC ${RUC_QUE_EL_SANDBOX_ACEPTA}`);
  console.log(`Cliente: ${cliente.name} · RUC ${cliente.tax_id} · ${cliente.client_status}`);

  // ── Una tasa activa cualquiera, para la línea ─────────────────────────────
  const { data: servicio } = await db
    .from("services_catalog")
    .select("id, code, name, default_tax_code, revenue_account")
    .eq("tenant_id", cliente.tenant_id)
    .eq("code", SERVICIO)
    .eq("active", true)
    .maybeSingle();
  if (!servicio) throw new Error(`No se encontró el servicio ${SERVICIO} activo.`);
  console.log(`Servicio: ${servicio.code} · tipo ${KIND} · cuenta ${servicio.revenue_account}`);

  const { data: tasa } = await db
    .from("tax_codes")
    .select("id, code, rate")
    .eq("tenant_id", cliente.tenant_id)
    .eq("active", true)
    .eq("code", String(servicio.default_tax_code))
    .maybeSingle();
  if (!tasa) throw new Error(`No se encontró la tasa ${servicio.default_tax_code} activa.`);

  const { data: usuario } = await db
    .from("users")
    .select("id")
    .eq("tenant_id", cliente.tenant_id)
    .limit(1)
    .maybeSingle();

  // ── Alta ──────────────────────────────────────────────────────────────────
  const creada = await createInvoice(db as never, String(cliente.tenant_id), String(usuario?.id ?? ""), {
    invoice_kind: KIND,
    client_id: String(cliente.id),
    case_id: null,
    issue_date: hoy(),
    due_date: enDias(30),
    notes: "Prueba 5 del Bloque 9B — medir la respuesta exitosa de CreateCancellation",
    lines: [
      {
        service_id: String(servicio.id),
        description: "Prueba 9B — medir la respuesta de la anulación ante la DGI",
        quantity: 1,
        unit_price: 10,
        tax_code_id: String(tasa.id),
        tax_code: String(tasa.code),
        tax_rate: Number(tasa.rate),
      },
    ],
  });
  console.log(`\nBorrador creado: ${creada.id}`);

  // ── Emitir (le asigna número y postea el asiento) ─────────────────────────
  const emitida = await emitInvoice(
    db as never,
    String(cliente.tenant_id),
    String(creada.id),
    db as never,
    String(usuario?.id ?? "")
  );
  console.log(`\n✅ EMITIDA: ${emitida.invoice_number}`);
  console.log(`   id: ${creada.id}`);
  console.log(
    `\n   → Ahora: "Enviar al PAC" y después "Anular factura" desde\n` +
      `     https://crm-integra-legal-git-develop-olivercalvos-projects.vercel.app/finanzas/facturas/${creada.id}`
  );
}

main().catch((err) => {
  console.error("\n❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
