import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * El último intento de anulación ante la DGI de una factura.
 *
 * Lo usa el detalle para pre-cargar el motivo cuando hay que **completar** una
 * anulación que quedó a medias (D4). No es una comodidad: el motivo que ya
 * viajó a la DGI y el que va a quedar en el libro tienen que ser **el mismo**.
 * Si la pantalla pidiera escribirlo de nuevo, la factura terminaría con un
 * motivo en la DGI y otro distinto en su nota de crédito, y la única forma de
 * notarlo sería comparar los dos documentos a mano.
 */
export interface UltimoIntentoDeAnulacion {
  intento: number;
  motivo: string;
  resultado: string;
  cufe: string;
  created_at: string;
}

export async function ultimoIntentoDeAnulacion(
  db: SupabaseClient,
  tenantId: string,
  invoiceId: string
): Promise<UltimoIntentoDeAnulacion | null> {
  const { data, error } = await db
    .from("fe_anulaciones")
    .select("intento, motivo, resultado, cufe, created_at")
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId)
    .order("intento", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Un fallo acá no puede tumbar el detalle de la factura: es información de
  // apoyo. Sin ella, el diálogo pide el motivo en blanco.
  if (error || !data) return null;

  return {
    intento: Number(data.intento),
    motivo: String(data.motivo ?? ""),
    resultado: String(data.resultado ?? ""),
    cufe: String(data.cufe ?? ""),
    created_at: String(data.created_at ?? ""),
  };
}
