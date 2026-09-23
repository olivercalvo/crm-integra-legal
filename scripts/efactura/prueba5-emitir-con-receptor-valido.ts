/**
 * PRUEBA 5, PASO 2 — emitir al sandbox apuntando el receptor al RUC del emisor.
 *
 *   npx tsx scripts/efactura/prueba5-emitir-con-receptor-valido.ts <invoice_id>
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HAY QUE TOCAR EL CLIENTE
 * ─────────────────────────────────────────────────────────────────────────────
 * La DGI de pruebas rechaza con `1601` / `1602` **cualquier RUC de receptor que
 * no exista en su registro**, y los clientes de staging son ficticios. Medido
 * hoy: el mismo cliente rebota igual como `tipoDocumento 01` que como `09`, así
 * que no es cuestión del tipo de documento.
 *
 * El procedimiento que ya se usó en junio y el 17/09 es apuntar el cliente al
 * **RUC/DV del emisor** (emisor = receptor está aceptado en sandbox) y
 * restaurarlo al terminar. Está escrito en `task_plan.md`.
 *
 * 🔴 EN LAS TRES COLUMNAS: `tax_id`, `ruc` y `digito_verificador`.
 *    `map-receptor.ts` lee `tax_id ?? ruc`, así que cambiar sólo `ruc` no
 *    alcanza — ya se perdió un intento por eso.
 *
 * 🔴 Y LA RESTAURACIÓN VA EN UN `finally`. Dejar un cliente de staging apuntando
 *    al RUC del bufete es el tipo de resto que después aparece en un reporte y
 *    nadie sabe de dónde salió. No depende de que el script termine bien.
 *
 * Imprime y verifica el ambiente antes de la llamada, y aborta si no es
 * `i_amb = 2`. El RUC del emisor NO se imprime.
 */
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../../.env.local") });

import { createClient } from "@supabase/supabase-js";
import { emitInvoiceToEfactura } from "../../src/lib/finanzas/efactura/orchestration/emit-invoice-to-efactura";

const INVOICE_ID = process.argv[2];

function confirmarAmbiente(paso: string) {
  const iAmb = process.env.EFACTURA_I_AMB;
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV;
  console.log(`\n🔒 [${paso}] AMBIENTE: EFACTURA_I_AMB = ${iAmb}  ·  NEXT_PUBLIC_APP_ENV = ${appEnv}`);
  if (iAmb !== "2") throw new Error(`ABORTADO: EFACTURA_I_AMB = ${iAmb}. Sólo sandbox (2).`);
  if (appEnv === "production") throw new Error("ABORTADO: appEnv = production.");
}

/** `1499876-1-690042` → `149…042`. Para poder comparar sin publicar el número. */
function enmascarar(v: string | null): string {
  if (!v) return "(vacío)";
  return v.length <= 6 ? "…" : `${v.slice(0, 3)}…${v.slice(-3)}`;
}

async function main() {
  if (!INVOICE_ID) throw new Error("Falta el invoice_id.");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const rucEmisor = process.env.EFACTURA_EMISOR_RUC;
  const dvEmisor = process.env.EFACTURA_EMISOR_DV;
  if (!url || !key) throw new Error("Faltan credenciales de Supabase en .env.local");
  if (!rucEmisor || !dvEmisor) throw new Error("Faltan EFACTURA_EMISOR_RUC / _DV en .env.local");

  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: inv, error } = await db
    .from("invoices")
    .select("id, tenant_id, invoice_number, invoice_kind, status, fe_estado, client_id")
    .eq("id", INVOICE_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!inv) throw new Error("No existe esa factura.");

  const { data: cli } = await db
    .from("clients")
    .select("id, name, tax_id, ruc, digito_verificador")
    .eq("id", inv.client_id)
    .maybeSingle();
  if (!cli) throw new Error("No existe el cliente de esa factura.");

  console.log(`\nFactura: ${inv.invoice_number} · ${inv.invoice_kind} · fe: ${inv.fe_estado}`);
  console.log(`Cliente: ${cli.name}`);
  console.log(
    `  original → tax_id ${enmascarar(cli.tax_id as string)} · ruc ${enmascarar(cli.ruc as string)} · dv ${cli.digito_verificador}`
  );

  const original = {
    tax_id: cli.tax_id,
    ruc: cli.ruc,
    digito_verificador: cli.digito_verificador,
  };

  const { data: usuario } = await db
    .from("users").select("id").eq("tenant_id", inv.tenant_id).limit(1).maybeSingle();

  let resultado: unknown = null;
  try {
    // ── Apuntar el receptor al emisor, en las TRES columnas ──────────────────
    const { error: errUp } = await db
      .from("clients")
      .update({ tax_id: rucEmisor, ruc: rucEmisor, digito_verificador: dvEmisor })
      .eq("id", cli.id);
    if (errUp) throw new Error(`No se pudo apuntar el receptor: ${errUp.message}`);
    console.log(`  temporal → las tres columnas apuntan al RUC/DV del emisor`);

    confirmarAmbiente("emision");
    console.log("→ POST /api/v1/Invoices  (emisión al sandbox)\n");

    resultado = await emitInvoiceToEfactura(
      db as never,
      String(inv.tenant_id),
      String(usuario?.id ?? ""),
      String(inv.id)
    );
    console.log(JSON.stringify(resultado, null, 2));
  } finally {
    // 🔴 Pase lo que pase. Ver el encabezado.
    const { error: errRest } = await db.from("clients").update(original).eq("id", cli.id);
    console.log(
      errRest
        ? `\n🔴 NO SE PUDO RESTAURAR EL CLIENTE: ${errRest.message} — hay que hacerlo a mano.`
        : `\n✅ cliente restaurado (tax_id ${enmascarar(original.tax_id as string)})`
    );
  }

  const r = resultado as { feEstado?: string; cufe?: string | null } | null;
  if (r?.feEstado === "authorized") {
    console.log(`\n✅ AUTORIZADA. CUFE:\n${r.cufe}`);
    console.log(
      `\n   → Ahora: npx tsx scripts/efactura/prueba5-anular.ts ${INVOICE_ID}`
    );
  } else {
    console.log(`\n⚠️ fe_estado = ${r?.feEstado}`);
  }
}

main().catch((err) => {
  console.error("\n❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
