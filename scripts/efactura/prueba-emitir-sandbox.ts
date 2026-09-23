/**
 * PRUEBA 1 DEL BLOQUE 9B — línea base: emitir un documento al SANDBOX.
 *
 *   npx tsx scripts/efactura/prueba-emitir-sandbox.ts <invoice_id>
 *
 * Existe por una razón puntual: para saber **cómo se ve una anulación que la
 * DGI acepta** hace falta un documento autorizado que no tenga ya un evento de
 * anulación encima. El único documento autorizado que había en staging
 * (`FAC-REI-000002`) devolvió `0622 — Ya existe un evento de anulación para
 * esta FE`, y como el PAC **no tiene endpoint para listar eventos**, no hay
 * forma de saber si ese evento lo creamos nosotros o ya estaba. Un documento
 * nuevo saca la duda del medio.
 *
 * Se corre desde acá y no desde la pantalla porque los deploys de Preview no
 * tienen cargadas las credenciales del sandbox — cargarlas es un cambio de
 * env vars en la cuenta del cliente, y eso lo decide Oliver (`task_plan.md`).
 *
 * 🔴 Imprime el ambiente antes de llamar, como el resto de las pruebas de este
 * bloque, y aborta si no es `i_amb = 2`.
 *
 * ESCRIBE EN STAGING: la emisión quema un correlativo del punto de facturación
 * y deja la factura `authorized` con su CUFE. Es lo mismo que hace el botón
 * "Enviar al PAC", por el mismo código.
 */
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../../.env.local") });

import { createClient } from "@supabase/supabase-js";
import { emitInvoiceToEfactura } from "../../src/lib/finanzas/efactura/orchestration/emit-invoice-to-efactura";

const INVOICE_ID = process.argv[2];

function confirmarAmbiente() {
  const iAmb = process.env.EFACTURA_I_AMB;
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV;
  console.log(`\n🔒 AMBIENTE: EFACTURA_I_AMB = ${iAmb}  ·  NEXT_PUBLIC_APP_ENV = ${appEnv}`);
  if (iAmb !== "2") throw new Error(`ABORTADO: EFACTURA_I_AMB = ${iAmb}. Sólo sandbox (2).`);
  if (appEnv === "production") throw new Error("ABORTADO: appEnv = production.");
}

async function main() {
  if (!INVOICE_ID) throw new Error("Falta el invoice_id: npx tsx ... <invoice_id>");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local");

  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: inv, error } = await db
    .from("invoices")
    .select("id, tenant_id, invoice_number, invoice_kind, status, fe_estado, issue_date, grand_total")
    .eq("id", INVOICE_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!inv) throw new Error("No existe esa factura.");

  console.log("\nFactura:", inv.invoice_number, "·", inv.invoice_kind, "·", inv.status,
    "· fe:", inv.fe_estado, "· emisión:", inv.issue_date, "· total:", inv.grand_total);

  const { data: user } = await db
    .from("users").select("id").eq("tenant_id", inv.tenant_id).limit(1).maybeSingle();

  confirmarAmbiente();
  console.log("→ POST /api/v1/Invoices  (emisión al sandbox)\n");

  const r = await emitInvoiceToEfactura(
    db as never,
    String(inv.tenant_id),
    String(user?.id ?? ""),
    String(inv.id)
  );

  console.log(JSON.stringify(r, null, 2));
  console.log(`\n${r.feEstado === "authorized" ? "✅" : "⚠️"} fe_estado = ${r.feEstado}`);
  if (r.cufe) console.log(`CUFE: ${r.cufe}`);
}

main().catch((err) => {
  console.error("\n❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
