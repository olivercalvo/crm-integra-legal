/**
 * Apunta UN cliente de staging al RUC/DV del emisor MIENTRAS se emite desde la
 * PANTALLA, y lo restaura en un `finally`.
 *
 *   npx tsx scripts/efactura/sostener-receptor-emisor.ts <client_number> <invoice_number> [minutos=10]
 *
 * Es el mismo procedimiento que `prueba5-emitir-con-receptor-valido.ts` (el
 * sandbox rechaza con 1601/1602 todo RUC de receptor ficticio; emisor =
 * receptor está aceptado), con una diferencia: acá NO se llama al PAC desde el
 * script. El script sostiene el cambio y espera a que la factura salga de
 * `no_emitida`/`error` porque alguien apretó «Enviar a la DGI» en la
 * interfaz. Así lo que se prueba es la ruta de la app desplegada, no una
 * llamada directa a la función.
 *
 * 🔴 LAS TRES COLUMNAS (`tax_id`, `ruc`, `digito_verificador`) y la
 *    restauración en un `finally`, también ante Ctrl+C y al vencer el plazo.
 * 🔴 Solo staging y sandbox: aborta si `EFACTURA_I_AMB` no es 2, si
 *    `NEXT_PUBLIC_APP_ENV` es production o si la URL de Supabase es la de
 *    producción. El RUC del emisor NO se imprime.
 */
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../../.env.local") });

import { createClient } from "@supabase/supabase-js";

const [CLIENT_NUMBER, INVOICE_NUMBER, MINUTOS = "10"] = process.argv.slice(2);
const PROD_REF = "uqmmkklbhzxqybljiecs";

function enmascarar(v: string | null): string {
  if (!v) return "(vacío)";
  return v.length <= 6 ? "…" : `${v.slice(0, 3)}…${v.slice(-3)}`;
}

async function main() {
  if (!CLIENT_NUMBER || !INVOICE_NUMBER) {
    throw new Error("uso: sostener-receptor-emisor.ts <client_number> <invoice_number> [minutos]");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const rucEmisor = process.env.EFACTURA_EMISOR_RUC;
  const dvEmisor = process.env.EFACTURA_EMISOR_DV;
  if (process.env.EFACTURA_I_AMB !== "2") throw new Error("ABORTADO: EFACTURA_I_AMB no es 2.");
  if (process.env.NEXT_PUBLIC_APP_ENV === "production") throw new Error("ABORTADO: app_env = production.");
  if (!url || url.includes(PROD_REF)) throw new Error("ABORTADO: la URL de Supabase no es la de staging.");
  if (!key || !rucEmisor || !dvEmisor) throw new Error("Faltan variables en .env.local.");

  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: cli } = await db
    .from("clients")
    .select("id, name, tenant_id, tax_id, ruc, digito_verificador")
    .eq("client_number", CLIENT_NUMBER)
    .maybeSingle();
  if (!cli) throw new Error(`No existe el cliente ${CLIENT_NUMBER}.`);

  const { data: inv } = await db
    .from("invoices")
    .select("id, invoice_number, fe_estado, client_id")
    .eq("tenant_id", cli.tenant_id)
    .eq("invoice_number", INVOICE_NUMBER)
    .maybeSingle();
  if (!inv) throw new Error(`No existe la factura ${INVOICE_NUMBER}.`);
  if (inv.client_id !== cli.id) throw new Error(`${INVOICE_NUMBER} no es de ${CLIENT_NUMBER}.`);
  const estadoInicial = inv.fe_estado as string;

  const original = { tax_id: cli.tax_id, ruc: cli.ruc, digito_verificador: cli.digito_verificador };
  console.log(`Cliente ${CLIENT_NUMBER} (${cli.name}) · original tax_id ${enmascarar(cli.tax_id as string)} · dv ${cli.digito_verificador}`);
  console.log(`Factura ${INVOICE_NUMBER} · fe_estado inicial: ${estadoInicial}`);

  let restaurado = false;
  const restaurar = async () => {
    if (restaurado) return;
    restaurado = true;
    const { error } = await db.from("clients").update(original).eq("id", cli.id);
    console.log(
      error
        ? `🔴 NO SE PUDO RESTAURAR ${CLIENT_NUMBER}: ${error.message}. Hay que hacerlo a mano.`
        : `✅ ${CLIENT_NUMBER} restaurado (tax_id ${enmascarar(original.tax_id as string)})`
    );
  };
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => void restaurar().then(() => process.exit(130)));
  }

  try {
    const { error: errUp } = await db
      .from("clients")
      .update({ tax_id: rucEmisor, ruc: rucEmisor, digito_verificador: dvEmisor })
      .eq("id", cli.id);
    if (errUp) throw new Error(`No se pudo apuntar el receptor: ${errUp.message}`);
    console.log("LISTO: el receptor apunta al emisor. Apretar «Enviar a la DGI» en la pantalla.");

    const limite = Date.now() + Number(MINUTOS) * 60_000;
    let visto = estadoInicial;
    while (Date.now() < limite) {
      await new Promise((r) => setTimeout(r, 3000));
      const { data } = await db.from("invoices").select("fe_estado").eq("id", inv.id).maybeSingle();
      const ahora = (data?.fe_estado as string) ?? visto;
      if (ahora !== visto) console.log(`  fe_estado: ${visto} → ${ahora}`);
      visto = ahora;
      if (ahora === "authorized" || ahora === "rejected" || (ahora === "error" && estadoInicial !== "error")) break;
    }
    console.log(`Final: fe_estado = ${visto}`);
  } finally {
    await restaurar();
  }
}

main().catch((err) => {
  console.error("❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
