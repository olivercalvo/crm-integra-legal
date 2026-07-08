/**
 * Server-only: wrapper TS sobre el RPC `public.allocate_fe_numero`.
 *
 * Reserva atómicamente el siguiente correlativo `numero_documento` para un
 * (tenant, punto de facturación) dado y lo devuelve como `number`.
 *
 * Régimen:
 *   - El RPC es SECURITY DEFINER en la BD, así que bypassa RLS. La función
 *     espera recibir un admin client (service role); el caller pasa el
 *     `tenant_id` correcto desde el contexto autenticado del route handler.
 *     Mismo patrón que `get_next_sequence_number` en api/quotes.ts y
 *     api/invoices.ts.
 *   - El RPC ya valida formato de `puntoFacturacion` (^\d{3}$ y != '000');
 *     duplicamos el check acá para fallar temprano sin round-trip a la BD.
 *
 * IMPORTANTE: el número se "consume" en cuanto este RPC retorna. Si la
 * emisión posterior falla y no se persiste un INSERT en fe_emisiones /
 * invoices, queda un gap. Para producción se planea envolver
 * allocate_fe_numero + INSERT del documento en una RPC SECURITY DEFINER
 * única (sprint posterior).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUNTO_RE = /^\d{3}$/;

export interface AllocateFeNumeroInput {
  tenantId: string;
  puntoFacturacion: string; // 3 dígitos, != '000'
}

/**
 * Invoca el RPC `allocate_fe_numero` y devuelve el correlativo asignado.
 *
 * @throws Error si los argumentos son inválidos, si el RPC falla, o si la
 *               respuesta no es numérica.
 */
export async function allocateFeNumero(
  db: SupabaseClient,
  input: AllocateFeNumeroInput,
): Promise<number> {
  const { tenantId, puntoFacturacion } = input;

  if (!tenantId || !UUID_RE.test(tenantId)) {
    throw new Error(
      `[efactura/allocateFeNumero] tenantId inválido: "${tenantId}" (esperado UUID)`,
    );
  }

  if (!puntoFacturacion || !PUNTO_RE.test(puntoFacturacion) || puntoFacturacion === "000") {
    throw new Error(
      `[efactura/allocateFeNumero] puntoFacturacion inválido: "${puntoFacturacion}" (esperado 3 dígitos numéricos distinto de "000")`,
    );
  }

  const { data, error } = await db.rpc("allocate_fe_numero", {
    p_tenant_id: tenantId,
    p_punto_facturacion: puntoFacturacion,
  });

  if (error) {
    throw new Error(
      `[efactura/allocateFeNumero] RPC allocate_fe_numero falló: ${error.message}`,
    );
  }

  // El RPC retorna BIGINT. supabase-js convierte BIGINT pequeños a number;
  // si excediera Number.MAX_SAFE_INTEGER llegaría como string. No esperamos
  // ese rango acá (correlativos por punto de facturación), pero validamos
  // explícitamente y rechazamos si no encaja.
  if (typeof data !== "number" || !Number.isFinite(data) || !Number.isInteger(data) || data < 1) {
    throw new Error(
      `[efactura/allocateFeNumero] respuesta inesperada del RPC: ${JSON.stringify(data)} (esperado entero >= 1)`,
    );
  }

  return data;
}
