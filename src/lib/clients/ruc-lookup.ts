/**
 * Unicidad de RUC de cliente — FUENTE ÚNICA para las 3 vías de alta/edición:
 * POST /api/clients, PATCH /api/clients/[id] e importación masiva.
 *
 * Contexto (2026-07): CLI-116 (INMOBILIARIA CAMAY) se creó con el mismo RUC que
 * CLI-104 ya existente, sin ninguna alerta → duplicado que confundió a la
 * licenciada y hubo que limpiar a mano. El POST solo validaba unicidad de
 * `client_number`, NUNCA del RUC.
 *
 * Regla: un RUC ya usado por un cliente ACTIVO (client_status != 'inactive') no
 * puede volver a ingresarse.
 *
 * El RUC del cliente puede vivir en DOS columnas: `ruc` (legacy) o `tax_id`
 * (registros nuevos). Por eso se compara contra AMBAS, trimmeadas.
 *
 * El núcleo (normalizeRucKey / clientMatchesRuc / findActiveClientMatch) es PURO
 * (sin I/O) para testearlo sin BD; findActiveClientByRuc hace el I/O contra
 * Supabase reutilizando ese núcleo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Referencia mínima al cliente existente que ya usa el RUC (para el mensaje). */
export interface ExistingClientRef {
  id: string;
  client_number: string;
  name: string;
}

/** Fila candidata leída de `clients` para el cotejo de unicidad. */
export interface ClientRucCandidate {
  id: string;
  client_number: string;
  name: string;
  ruc: string | null;
  tax_id?: string | null;
  client_status?: string | null;
}

/**
 * Normaliza un identificador fiscal para comparar unicidad: trim. Vacío/null →
 * "" (un RUC vacío nunca colisiona). Comparación exacta tras trim: el RUC
 * panameño es un identificador formal numérico, no se aplica case-folding.
 */
export function normalizeRucKey(raw: unknown): string {
  if (raw == null) return "";
  return String(raw).trim();
}

/** ¿El candidato usa este RUC? Compara contra `ruc` OR `tax_id`, ambos trim. */
export function clientMatchesRuc(candidate: ClientRucCandidate, rucKey: string): boolean {
  if (!rucKey) return false;
  const byRuc = normalizeRucKey(candidate.ruc);
  const byTaxId = normalizeRucKey(candidate.tax_id);
  return (byRuc !== "" && byRuc === rucKey) || (byTaxId !== "" && byTaxId === rucKey);
}

/**
 * Devuelve el primer cliente ACTIVO que ya usa `ruc` (contra ruc OR tax_id),
 * excluyendo inactivos y opcionalmente `excludeClientId` (el propio registro en
 * un edit). null si no hay colisión o si el RUC viene vacío.
 */
export function findActiveClientMatch(
  candidates: ClientRucCandidate[],
  ruc: string,
  excludeClientId?: string
): ExistingClientRef | null {
  const rucKey = normalizeRucKey(ruc);
  if (!rucKey) return null;
  for (const c of candidates) {
    if (excludeClientId && c.id === excludeClientId) continue;
    if (c.client_status === "inactive") continue;
    if (clientMatchesRuc(c, rucKey)) {
      return { id: c.id, client_number: c.client_number, name: c.name };
    }
  }
  return null;
}

/**
 * Wrapper con I/O: lee los clientes NO inactivos del tenant y aplica
 * findActiveClientMatch. Usado por POST y PATCH. Si el RUC viene vacío devuelve
 * null sin tocar la BD.
 */
export async function findActiveClientByRuc(
  admin: SupabaseClient,
  tenantId: string,
  ruc: string,
  excludeClientId?: string
): Promise<ExistingClientRef | null> {
  const rucKey = normalizeRucKey(ruc);
  if (!rucKey) return null;

  const { data } = await admin
    .from("clients")
    .select("id, client_number, name, ruc, tax_id, client_status")
    .eq("tenant_id", tenantId)
    .neq("client_status", "inactive");

  return findActiveClientMatch((data ?? []) as ClientRucCandidate[], rucKey, excludeClientId);
}

/**
 * Mensaje accionable único que NOMBRA la ficha existente para reutilizarla.
 * Tuteo neutro panameño (voseo es anti-patrón en el proyecto, ver CLAUDE.md).
 */
export function rucConflictMessage(existing: ExistingClientRef): string {
  return `Ya existe un cliente con ese RUC: ${existing.client_number} (${existing.name}). Usa esa ficha en lugar de crear una nueva.`;
}
