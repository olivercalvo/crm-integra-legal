/**
 * LOS TERCEROS QUE UNA LÍNEA DEL LIBRO PUEDE NOMBRAR (migración `054`).
 *
 * Josuarth, en la reunión: que una línea de asiento pueda decir de qué cliente
 * o de qué proveedor se trata, porque un movimiento contra cuentas por cobrar o
 * por pagar sin tercero no le sirve al auxiliar.
 *
 * Son dos tablas distintas y se leen en dos consultas, una sola vez por
 * pantalla: las N líneas del formulario comparten la misma lista.
 *
 * ⚠️ **Acá NO se filtra por `active`.** Un asiento de ajuste puede tocar la
 * cuenta de un cliente con el que el bufete dejó de trabajar —de hecho es uno
 * de los motivos típicos de un ajuste— y un tercero inactivo que no aparece en
 * la lista obliga a reactivarlo para poder cargar el asiento, que es peor.
 * El filtro real lo pone el RPC: el tercero tiene que ser de ESTE bufete.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type DB = SupabaseClient;

export interface TerceroOption {
  id: string;
  /** Lo que se lee en el `<option>`: nombre y número de ficha. */
  nombre: string;
  numero: string | null;
}

export interface TercerosDelLibro {
  clientes: TerceroOption[];
  proveedores: TerceroOption[];
}

export async function listTercerosDelLibro(
  db: DB,
  tenantId: string
): Promise<TercerosDelLibro> {
  const [cli, prov] = await Promise.all([
    db
      .from("clients")
      .select("id, name, client_number")
      .eq("tenant_id", tenantId)
      .order("name"),
    db
      .from("suppliers")
      .select("id, legal_name, supplier_number")
      .eq("tenant_id", tenantId)
      .order("legal_name"),
  ]);

  if (cli.error) console.error("[finanzas/queries] listTercerosDelLibro(clients) failed", cli.error);
  if (prov.error) console.error("[finanzas/queries] listTercerosDelLibro(suppliers) failed", prov.error);

  return {
    clientes: ((cli.data ?? []) as { id: string; name: string; client_number: string | null }[]).map(
      (c) => ({ id: c.id, nombre: c.name, numero: c.client_number })
    ),
    proveedores: (
      (prov.data ?? []) as { id: string; legal_name: string; supplier_number: string | null }[]
    ).map((s) => ({ id: s.id, nombre: s.legal_name, numero: s.supplier_number })),
  };
}
