/**
 * SALDO POR PAGAR DE CADA PROVEEDOR (14/10/2026).
 *
 * 🔴 Sale de la ANTIGÜEDAD POR PAGAR, no de las compras del módulo: el mismo
 * `loadAntiguedad(…, "pagar")` + `buildAntiguedad` que dibuja el reporte. Así
 * entran las compras y los gastos de trámite en el libro, las NC de proveedor y
 * las partidas de 200001 con el proveedor como tercero (las que llegan por la
 * importación de asientos o por la apertura), y el saldo de cada proveedor es,
 * por construcción, el de su fila en la antigüedad de hoy. Antes el listado
 * sumaba sólo `business_expenses` en `pendiente_pago`: un proveedor cargado por
 * importación (Panamá Star) salía en 0.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadAntiguedad } from "@/lib/finanzas/reports/antiguedad-source";
import { buildAntiguedad, type DocumentoPendiente, type FilaTercero } from "@/lib/finanzas/reports/antiguedad";
import { hoyEnPanama } from "@/lib/utils/hoy-en-panama";

type DB = SupabaseClient;

export interface SaldoDeProveedor {
  /** Lo que se le debe (puede ser negativo: saldo a favor del bufete). */
  saldo: number;
  /** Documentos con saldo por pagar: compras, gastos de trámite y partidas del libro. */
  pendientes: number;
  /** Los documentos de la antigüedad, del más vencido al menos. */
  documentos: DocumentoPendiente[];
}

/** Puro: las filas de la antigüedad por pagar, por id de proveedor. */
export function saldosPorProveedor(filas: FilaTercero[]): Map<string, SaldoDeProveedor> {
  const out = new Map<string, SaldoDeProveedor>();
  for (const f of filas) {
    if (!f.terceroId) continue;
    out.set(f.terceroId, {
      saldo: f.total,
      pendientes: f.documentos.filter((d) => d.saldo > 0.005).length,
      documentos: f.documentos,
    });
  }
  return out;
}

/** La antigüedad por pagar de hoy (Panamá), agrupada por proveedor. */
export async function cargarSaldosDeProveedores(
  db: DB,
  tenantId: string,
  corte: string = hoyEnPanama()
): Promise<Map<string, SaldoDeProveedor>> {
  const { documentos, control } = await loadAntiguedad(db, tenantId, "pagar", corte);
  return saldosPorProveedor(buildAntiguedad(documentos, control).filas);
}
