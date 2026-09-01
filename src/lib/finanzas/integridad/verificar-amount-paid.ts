/**
 * La verificación de `amount_paid` contra la base, para los seeds.
 *
 * Separado de `amount-paid-derivado.ts` a propósito: ahí vive el núcleo PURO,
 * que se testea sin red ni credenciales. Acá vive lo que necesita un cliente de
 * Supabase. Si los dos vivieran juntos, el test tendría que arrastrar el cliente
 * para probar una comparación de números.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  desfasesDeAmountPaid,
  formatearDesfases,
  type AplicacionParaVerificar,
  type DesfaseAmountPaid,
  type FacturaParaVerificar,
} from "./amount-paid-derivado";

/**
 * Lee facturas y aplicaciones del tenant y devuelve los desfases.
 *
 * Dos consultas planas, no un join: PostgREST no agrega, así que la suma se hace
 * acá con la función pura — que es justamente la que cubre el test.
 */
export async function buscarDesfasesDeAmountPaid(
  db: SupabaseClient,
  tenantId: string
): Promise<DesfaseAmountPaid[]> {
  const { data: facturas, error: errF } = await db
    .from("invoices")
    .select("id, invoice_number, status, amount_paid")
    .eq("tenant_id", tenantId);
  if (errF) throw new Error(`verificar amount_paid — leer facturas: ${errF.message}`);

  const { data: aplicaciones, error: errA } = await db
    .from("payment_applications")
    .select("invoice_id, amount_applied")
    .eq("tenant_id", tenantId);
  if (errA) throw new Error(`verificar amount_paid — leer aplicaciones: ${errA.message}`);

  return desfasesDeAmountPaid(
    (facturas ?? []) as FacturaParaVerificar[],
    (aplicaciones ?? []) as AplicacionParaVerificar[]
  );
}

/**
 * Igual que la anterior, pero corta el proceso si encuentra algo. Es la forma en
 * que la usan los dos seeds al terminar: una siembra que deja datos incoherentes
 * tiene que fallar en el momento, no seis días después en una pantalla.
 */
export async function verificarAmountPaidDerivado(
  db: SupabaseClient,
  tenantId: string
): Promise<void> {
  const desfases = await buscarDesfasesDeAmountPaid(db, tenantId);

  if (desfases.length > 0) {
    console.error(`\n❌ ABORTADO — ${formatearDesfases(desfases)}\n`);
    process.exit(1);
  }

  console.log("🔎 Verificación: `amount_paid` coincide con los pagos en todas las facturas.");
}
