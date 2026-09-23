import type { SupabaseClient } from "@supabase/supabase-js";
import type { CodigoDgi } from "@/lib/finanzas/efactura/mensajes-dgi";

/**
 * EL ÚLTIMO ENVÍO AL PAC QUE NO SALIÓ BIEN.
 *
 * El detalle del rechazo ya se guardaba —`fe_emisiones.cod_res` y
 * `response_payload`— pero **la pantalla no lo leía**: el detalle de la factura
 * decía "el último envío al PAC falló" y, para saber por qué, había que apretar
 * el botón otra vez y leerlo en el diálogo. O sea: para enterarse del motivo
 * del rechazo había que provocar otro.
 *
 * 🔴 SE LEE DE `fe_emisiones`, NO DE LA FACTURA, y eso es lo que hace que el
 *    aviso NO SE BORRE al editar. El registro del intento es historia: nada de
 *    lo que se toque en la ficha del cliente o en la factura lo cambia. Lo
 *    único que lo saca de la pantalla es un envío nuevo que salga bien —
 *    porque entonces `fe_estado` pasa a `authorized` y la sección del error
 *    deja de renderizarse.
 */
export interface UltimoEnvioFallido {
  intento: number;
  /** Los `gResProc` del PAC, tal como vinieron. */
  codigos: CodigoDgi[];
  /** `'pac_rejected' | 'pac_duplicate' | 'transport' | 'incierto'`, si quedó. */
  errorKind: string | null;
  createdAt: string;
  /** Ambiente en el que se hizo. 1 = DGI real, 2 = sandbox. */
  iAmb: number | null;
}

export async function ultimoEnvioFallido(
  db: SupabaseClient,
  tenantId: string,
  invoiceId: string
): Promise<UltimoEnvioFallido | null> {
  const { data, error } = await db
    .from("fe_emisiones")
    .select("intento, cod_res, response_payload, created_at, i_amb")
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId)
    .order("intento", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Un fallo acá no puede tumbar el detalle de la factura: es información de
  // apoyo. Sin ella, la pantalla muestra el aviso genérico de antes.
  if (error || !data) return null;

  const payload = (data.response_payload ?? {}) as Record<string, unknown>;
  const meta = (payload._meta ?? {}) as Record<string, unknown>;

  const codigos: CodigoDgi[] = Array.isArray(data.cod_res)
    ? (data.cod_res as unknown[]).flatMap((c) => {
        if (!c || typeof c !== "object") return [];
        const o = c as Record<string, unknown>;
        return [
          {
            codigo: typeof o.dCodRes === "string" ? o.dCodRes : undefined,
            mensaje: typeof o.dMsgRes === "string" ? o.dMsgRes : undefined,
          },
        ];
      })
    : [];

  return {
    intento: Number(data.intento),
    codigos,
    errorKind: typeof meta.errorKind === "string" ? meta.errorKind : null,
    createdAt: String(data.created_at ?? ""),
    iAmb: data.i_amb === null || data.i_amb === undefined ? null : Number(data.i_amb),
  };
}

/**
 * CUÁNTAS FACTURAS ESTÁN EN ERROR ANTE LA DGI.
 *
 * Es el contador del listado. Una factura rechazada que nadie reenvía es
 * exactamente el caso que trajo este bloque: se corrigió el cliente, la factura
 * quedó como estaba, y sin un número a la vista nadie se enteró.
 */
export async function contarFacturasConErrorDgi(
  db: SupabaseClient,
  tenantId: string
): Promise<number> {
  const { count, error } = await db
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("fe_estado", "error");

  if (error) return 0;
  return count ?? 0;
}
